const {
  delay,
  resolvePhaseAndMode,
  createERC,
  isoNow,
  now,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const {
  getBatchCacheTTLms,
  getEphemeralTTLms,
  getLongLivedTTLms,
} = require('../utils/ttl.cjs');

class OrderGenerator {
  constructor(ctx) {
    this.ctx = ctx;

    this.steps = {
      'order-data-generation': this._runOrderDataGenerationStep.bind(this),
      orders: this._runOrderCreationStep.bind(this),
    };
  }

  async generateOrders(config, options) {
    const { logger, persistence, batchCallback } = this.ctx;
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

    const steps = [
      { name: 'order-data-generation', type: 'sync' },
      { name: 'orders', type: 'sync' },
    ];

    await persistence.createSession({
      sessionId,
      flowType: 'orders',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: {
        config,
        options,
        steps,
      },
    });

    batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    logger.info('Order generation workflow started', {
      sessionId,
      steps: steps.map((s) => s.name),
      correlationId: config.correlationId,
    });

    return {
      sessionId,
      message: 'Order generation workflow started.',
    };
  }

  async _runOrderDataGenerationStep(sessionId) {
    const { logger, ai, mockData, persistence, liferay, batchCallback } =
      this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options } = session.context;

    logger.info('Starting order data generation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      this.validateConfig(config);
      await this.validateOptions(config, options);

      const { products, accounts } = await this.getProductsAndAccounts(config);

      let orderDataList;
      if (options.demoMode) {
        orderDataList = mockData.generateOrderData(
          options.orderCount,
          {},
          accounts
        );
      } else {
        orderDataList = await ai.generateOrderData(
          products,
          accounts,
          options.orderCount,
          config,
          config.aiModel
        );
      }

      await persistence.updateSessionContext(sessionId, {
        ...session.context,
        orderDataList,
        products,
        accounts,
      });

      logger.info('Order data generation step complete', {
        sessionId,
        correlationId: session.correlationId,
        orderCount: orderDataList.length,
      });

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'order-data-generation',
        status: 'SYNCHRONOUS',
      });
    } catch (error) {
      logger.error('Failed execution of order-data-generation step', {
        sessionId,
        correlationId: session.correlationId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'order-data-generation',
        status: 'FAILED',
      });
    }
  }

  async _runOrderCreationStep(sessionId) {
    const { logger, liferay, persistence, progress, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, orderDataList, accounts, products, warehouses } =
      session.context;

    logger.info('Starting order creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      const batchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
      const useBatch = batchSize > 1 && options.orderCount > 1;

      if (useBatch) {
        const chunks = [];
        for (let i = 0; i < orderDataList.length; i += batchSize) {
          chunks.push(orderDataList.slice(i, i + batchSize));
        }

        if (options.dryRun) {
          logger.info('DRY RUN: Skipping order creation batch submission.');
          for (const originalBatch of chunks) {
            const batch = originalBatch.map((od) =>
              this.buildOrderPayload(config, od, accounts, products, warehouses)
            );
            const batchERC = createERC(ERC_PREFIX.ORDER_BATCH);
            logger.info({
              dryRunData: {
                step: 'orders',
                count: batch.length,
                payload: batch,
              },
            });
            await persistence.createBatch({
              erc: batchERC,
              sessionId,
              stepKey: 'orders',
              status: 'SYNCHRONOUS',
            });
          }
          return;
        }

        for (let batchIndex = 0; batchIndex < chunks.length; batchIndex++) {
          const originalBatch = chunks[batchIndex];

          const batch = originalBatch.map((od) =>
            this.buildOrderPayload(config, od, accounts, products, warehouses)
          );

          const batchERC = createERC(ERC_PREFIX.ORDER_BATCH);

          await persistence.createBatch({
            erc: batchERC,
            sessionId,
            stepKey: 'orders',
            status: 'PREPARED',
          });

          const submission = await liferay.createOrdersBatch(config, batch, {
            externalReferenceCode: batchERC,
          });

          await persistence.updateBatch(batchERC, {
            status: 'SUBMITTED',
            downstreamBatchId: submission.batchId,
          });

          progress.batchStarted(
            {
              batchId: submission.batchId,
              entityType: 'orders',
              totalItems: batch.length,
              batchERC: batchERC,
            },
            { correlationId: config.correlationId }
          );

          logger.info('Orders batch submission completed', {
            batchId: submission.batchId,
            orderCount: batch.length,
          });
        }
      } else {
        if (options.dryRun) {
          logger.info('DRY RUN: Skipping individual order creation.');
          const batchERC = createERC(ERC_PREFIX.ORDER_BATCH);
          logger.info({
            dryRunData: {
              step: 'orders',
              count: orderDataList.length,
              payload: orderDataList.map((od) =>
                this.buildOrderPayload(
                  config,
                  od,
                  accounts,
                  products,
                  warehouses
                )
              ),
            },
          });
          await persistence.createBatch({
            erc: batchERC,
            sessionId,
            stepKey: 'orders',
            status: 'SYNCHRONOUS',
          });
          return;
        }
        await this.generateOrdersIndividually(
          config,
          options,
          orderDataList,
          accounts,
          products
        );
      }
    } catch (error) {
      logger.error('Failed execution of orders creation step', {
        sessionId,
        correlationId: session.correlationId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'orders',
        status: 'FAILED',
      });
    }
  }

  validateConfig(config) {
    const pollingRetriesValue = config.pollingRetries;
    if (pollingRetriesValue === undefined || pollingRetriesValue === null) {
      throw new Error('pollingRetries is required');
    }
    const pollingRetries = parseInt(pollingRetriesValue);
    if (isNaN(pollingRetries) || pollingRetries < 0 || pollingRetries > 20) {
      throw new Error('pollingRetries must be between 0 and 20');
    }

    const pollingDelayValue = config.pollingDelay;
    if (pollingDelayValue === undefined || pollingDelayValue === null) {
      throw new Error('pollingDelay is required');
    }
    const pollingDelay = parseInt(pollingDelayValue);
    if (isNaN(pollingDelay) || pollingDelay < 5000 || pollingDelay > 600000) {
      throw new Error('pollingDelay must be between 5 and 600 seconds');
    }

    const catalogIdValue = config.catalogId;
    if (catalogIdValue === undefined || catalogIdValue === null) {
      throw new Error('catalogId is required for fetching products');
    }
    const catalogId = parseInt(catalogIdValue);
    if (isNaN(catalogId) || catalogId <= 0) {
      throw new Error('catalogId must be a positive integer');
    }

    const ch = parseInt(config.channelId);
    if (!Number.isFinite(ch) || ch <= 0)
      throw new Error('channelId must be a positive integer');

    if (!config.currencyCode) throw new Error('currencyCode is required');
  }

  async validateOptions(config, options) {
    const { ai, logger } = this.ctx;

    if (
      !options.orderCount ||
      typeof options.orderCount !== 'number' ||
      options.orderCount <= 0
    ) {
      throw new Error('orderCount must be greater than 0');
    }

    if (!options.demoMode) {
      if (!config.aiModel) {
        const err = new Error(
          'AI model not configured. Please select an AI model in the AI Configuration object.'
        );
        err.statusCode = 400;
        logger.error(
          '✗ AI model validation failed for orders: missing aiModel'
        );
        throw err;
      }

      await ai.getOpenAIClient(config);
    }
  }

  async createSingleOrder(config, payload) {
    const { logger, liferay } = this.ctx;
    try {
      const createdOrder = await liferay.createOrder(config, payload);
      logger.info('Order created successfully', {
        orderId: createdOrder.id,
        externalReferenceCode: createdOrder.externalReferenceCode,
      });
      return createdOrder;
    } catch (error) {
      logger.error('Failed to create single order', {
        error: error.message,
        accountId: payload.accountId,
        erc: payload.externalReferenceCode,
      });
      throw error;
    }
  }

  buildOrderPayload(config, orderData, accounts, products, warehouses) {
    const { logger } = this.ctx;
    const accountId = this.pickAccountId(orderData.accountId, accounts);
    const orderStatus = this.normalizeOrderStatus(orderData.orderStatus);

    const orderItems = [];
    const itemCount = Math.floor(Math.random() * 3) + 1;

    const allPurchasableSkus = products.flatMap((p) =>
      (p.skus || []).filter((s) => {
        const result = s.purchasable && s.sku && p.productStatus === 0;
        if (!result) {
          logger.debug('SKU not purchasable', {
            sku: s.sku,
            s_purchasable: s.purchasable,
            p_productStatus: p.productStatus,
          });
        }
        return result;
      })
    );

    if (allPurchasableSkus.length === 0) {
      logger.error('No purchasable SKUs found across all products.', {
        totalProducts: products.length,
        productsWithSkus: products.filter((p) => p.skus && p.skus.length > 0)
          .length,
      });
      products.forEach((p) => {
        logger.debug('Product details for non-purchasable', {
          id: p.id,
          name: p.name,
          productStatus: p.productStatus,
          published: p.published,
          skus: p.skus,
        });
      });
      throw new Error('No products with purchasable SKUs found.');
    }

    logger.debug('All purchasable SKUs', {
      skus: allPurchasableSkus.map((s) => s.sku),
    });

    for (let i = 0; i < itemCount; i++) {
      const sku = allPurchasableSkus[i % allPurchasableSkus.length];

      const warehouse =
        warehouses && warehouses.length > 0
          ? warehouses[Math.floor(Math.random() * warehouses.length)]
          : null;

      orderItems.push({
        sku: sku.sku,
        skuExternalReferenceCode: sku.sku,
        quantity: Math.floor(Math.random() * 3) + 1,
        warehouseId: warehouse ? warehouse.id : undefined,
        unitPrice: sku.price,
      });
      logger.debug('Added order item', {
        sku: sku.sku,
        quantity: orderItems[orderItems.length - 1].quantity,
        unitPrice: sku.price,
        purchasable: sku.purchasable,
        productStatus: sku.productStatus,
        published: sku.published,
      });
    }

    return {
      accountId,
      channelId: parseInt(config.channelId, 10),
      currencyCode: config.currencyCode,
      orderDate: orderData.orderDate || isoNow(),
      orderStatus: parseInt(orderStatus, 10),
      externalReferenceCode:
        orderData.externalReferenceCode || createERC(ERC_PREFIX.ORDER),
      orderItems,
    };
  }

  async generateOrdersIndividually(
    config,
    options,
    orderDataList,
    accounts,
    products
  ) {
    const { logger, progress } = this.ctx;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: false,
      phase: 'generate',
    });

    const batchId = `orders-individual-${Date.now()}`;
    const batchERC = createERC(ERC_PREFIX.ORDER_BATCH);

    progress.batchStarted({
      batchId,
      batchERC,
      entityType: 'orders',
      totalItems: orderDataList.length,
      operation: 'generate',
      correlationId: config.correlationId,
    });

    const created = [];
    const errors = [];

    for (let i = 0; i < orderDataList.length; i++) {
      try {
        const payload = this.buildOrderPayload(
          config,
          orderDataList[i],
          accounts,
          products,
          options.warehouses
        );
        const createdOrder = await this.createSingleOrder(config, payload);
        created.push(createdOrder);

        progress.batchProgress(
          {
            batchId,
            batchERC,
            entityType: 'orders',
            completedCount: i + 1,
            totalItems: orderDataList.length,
            operation: 'generate',
          },
          { correlationId: config.correlationId }
        );
      } catch (e) {
        errors.push({ index: i, error: e.message });
        logger.error('Order creation failed', {
          correlationId: config.correlationId,
          operation: 'orders/create:error',
          error: e.message,
          orderIndex: i,
          mode: options.demoMode ? 'demo' : 'live',
        });
      }
    }

    progress.batchCompleted(
      {
        batchId,
        batchERC,
        entityType: 'orders',
        successCount: created.length,
        failureCount: errors.length,
        errors: errors,
        operation: 'generate',
      },
      { correlationId: config.correlationId }
    );

    logger.info('Order generation completed', {
      correlationId: config.correlationId,
      operation: 'orders/generate:complete',
      created: created.length,
      errors: errors.length,
      mode,
      phase,
    });

    return {
      orders: created,
      created: created.length,
      errors,
      success: errors.length === 0,
    };
  }

  pickAccountId(requestedId, accounts) {
    if (requestedId && accounts.find((a) => a.id === requestedId))
      return requestedId;
    const r = accounts[Math.floor(Math.random() * accounts.length)];
    return r.id;
  }

  normalizeOrderStatus(s) {
    if (typeof s === 'number') return s;
    const m = {
      open: 0,
      pending: 0,
      'in-progress': 1,
      processing: 1,
      shipped: 2,
      delivered: 10,
      completed: 10,
      cancelled: 15,
      canceled: 15,
    };
    return m[(s || '').toLowerCase()] ?? 0;
  }

  async getProductsAndAccounts(config) {
    const { liferay, logger } = this.ctx;

    const productsRes = await liferay.getProducts(config, {
      catalogId: config.catalogId,
    });
    const accountsRes = await liferay.getAccounts(config, {
      channelId: config.channelId,
    });

    const products = productsRes.items || [];
    const accounts = accountsRes.items || [];

    if (products.length === 0) {
      throw new Error('No products available. Please generate products first.');
    }

    if (accounts.length === 0) {
      throw new Error('No accounts available. Please generate accounts first.');
    }

    logger.trace('Dependencies ready', {
      operation: 'orders/dependencies:ready',
      productsCount: products.length,
      accountsCount: accounts.length,
    });

    return { products, accounts };
  }
}

module.exports = OrderGenerator;
