const BaseGenerator = require('./baseGenerator.cjs');
const {
  createERC,
  isoNow,
  resolveErrorReference,
} = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

/**
 * OrderGenerator - Specialized orchestrator for commerce order generation.
 */
class OrderGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    this.steps = {
      [S.GENERATE_ORDER_DATA]: this._runOrderDataGenerationStep.bind(this),
      [S.CREATE_ORDERS]: this._runOrderCreationStep.bind(this),
      [S.SUBFLOW_ORDERS]: this._runSubflowOrdersStep.bind(this),
      [S.SYNC_DELAY_ORDERS]: (sId) =>
        this._runInterServiceSyncDelayStep(sId, S.SYNC_DELAY_ORDERS),
    };
  }

  async _runSubflowOrdersStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;

    this.logger.info('Enqueuing generate-orders job for subflow', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      await this.ctx.queue.add('data-generation', 'generate-orders', {
        config,
        options: {
          ...options,
          count: options.orderCount || options.count || 1,
        },
        correlationId: session.correlationId,
      });

      await this.completeSyncStep(sessionId, S.SUBFLOW_ORDERS, 'SYNCHRONOUS');
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error(`Failed to enqueue orders subflow: ${error.message}`, {
        sessionId,
        errorReferenceCode,
        error,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.SUBFLOW_ORDERS,
        status: 'FAILED',
      });
      throw error;
    }
  }

  async runWorkflow(config, options) {
    const steps = [
      { name: S.SYNC_DELAY_ORDERS, type: 'sync' },
      {
        name: S.GENERATE_ORDER_DATA,
        type: 'sync',
        dependsOn: [S.CREATE_PRODUCTS, S.CREATE_ACCOUNTS],
      },
      { name: S.CREATE_ORDERS, type: 'sync' },
    ];

    const totals = {
      orders: options.orderCount || 0,
    };

    return super.runWorkflow(config, options, 'orders', steps, totals);
  }

  async _runOrderDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;

    this.logger.info('Starting order data generation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      this.validateConfig(config);
      await this.validateOptions(config, options);

      const { products, accounts } = await this.getProductsAndAccounts(
        config,
        session.context
      );

      const orderDataList = await this.ctx.generation.generateData(
        'order',
        options.orderCount,
        config,
        {
          ...options,
          products,
          accounts,
        }
      );

      await this.persistence.updateSessionContext(sessionId, {
        orderDataList,
      });

      this.logger.debug('Pre-selected dependencies for orders', {
        sessionId,
        products,
        accounts,
      });

      await this.completeSyncStep(
        sessionId,
        S.GENERATE_ORDER_DATA,
        'SYNCHRONOUS',
        orderDataList.length,
        orderDataList.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed execution of generate-order-data step', {
        sessionId,
        correlationId: session.correlationId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_ORDER_DATA,
        status: 'FAILED',
      });
      throw error;
    }
  }

  async _runOrderCreationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, orderDataList, accounts, products, warehouses } =
      session.context;

    this.logger.info('Starting order creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!orderDataList || orderDataList.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.CREATE_ORDERS,
          'BYPASSED'
        );
      }

      if (config.orderDistribution) {
        const statuses = [];
        const statusMap = {
          open: 0,
          processing: 1,
          shipped: 2,
          completed: 10,
        };
        for (const [key, pct] of Object.entries(config.orderDistribution)) {
          const statusId = statusMap[key];
          if (statusId !== undefined) {
            const count = Math.round((pct / 100) * orderDataList.length);
            for (let i = 0; i < count; i++) {
              statuses.push(statusId);
            }
          }
        }

        // Adjust length to match exactly
        while (statuses.length < orderDataList.length) {
          statuses.push(10); // Default to completed
        }
        if (statuses.length > orderDataList.length) {
          statuses.length = orderDataList.length;
        }

        // Shuffle the array to distribute the statuses randomly
        for (let i = statuses.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [statuses[i], statuses[j]] = [statuses[j], statuses[i]];
        }

        // Apply to orderDataList
        for (let i = 0; i < orderDataList.length; i++) {
          orderDataList[i].orderStatus = statuses[i];
        }
      }

      const batchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
      const useBatch = batchSize > 1 && options.orderCount > 1;

      if (useBatch) {
        const chunks = [];
        for (let i = 0; i < orderDataList.length; i += batchSize) {
          chunks.push(orderDataList.slice(i, i + batchSize));
        }

        if (options.dryRun) {
          return await this.completeSyncStep(
            sessionId,
            S.CREATE_ORDERS,
            'SYNCHRONOUS',
            orderDataList.length,
            orderDataList.length
          );
        }

        for (let batchIndex = 0; batchIndex < chunks.length; batchIndex++) {
          const originalBatch = chunks[batchIndex];
          const batch = originalBatch.map((od) =>
            this.buildOrderPayload(config, od, accounts, products, warehouses)
          );

          await this.submitBatch(
            sessionId,
            S.CREATE_ORDERS,
            'orders',
            'generate',
            (erc) =>
              this.liferay.createOrdersBatch(config, batch, {
                externalReferenceCode: erc,
              }),
            batch.length
          );
        }
      } else {
        if (options.dryRun) {
          return await this.completeSyncStep(
            sessionId,
            S.CREATE_ORDERS,
            'SYNCHRONOUS',
            orderDataList.length,
            orderDataList.length
          );
        }
        await this.generateOrdersIndividually(
          sessionId,
          config,
          options,
          orderDataList,
          accounts,
          products
        );
      }
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed execution of create-orders step', {
        sessionId,
        correlationId: session.correlationId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.CREATE_ORDERS,
        status: 'FAILED',
      });
      throw error;
    }
  }

  validateConfig(config) {
    if (!config.catalogId) throw new Error('catalogId is required');
    if (!config.channelId) throw new Error('channelId is required');
    if (!config.currencyCode) throw new Error('currencyCode is required');
  }

  async validateOptions(config, options) {
    if (!options.orderCount || options.orderCount <= 0) {
      throw new Error('orderCount must be greater than 0');
    }
  }

  async createSingleOrder(config, payload) {
    try {
      const createdOrder = await this.liferay.createOrder(config, payload);
      return createdOrder;
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to create single order', {
        errorReferenceCode,
        error: error.message,
      });
      throw error;
    }
  }

  buildOrderPayload(config, orderData, accounts, products, warehouses) {
    const account = this.pickAccount(orderData.accountId, accounts);
    const orderStatus = this.normalizeOrderStatus(orderData.orderStatus);

    const orderItems = [];
    const itemCount = Math.floor(Math.random() * 3) + 1;

    const allPurchasableSkus = products.flatMap((p) =>
      (p.skus || []).filter(
        (s) => s.purchasable && s.sku && p.productStatus === 0
      )
    );

    this.logger.debug(
      `Found ${allPurchasableSkus.length} purchasable SKUs across ${products.length} products.`,
      { sessionId: config.sessionId }
    );

    if (allPurchasableSkus.length === 0) {
      this.logger.error('No purchasable SKUs found. Cannot create orders.', {
        productCount: products.length,
        firstProduct: products[0]
          ? {
              id: products[0].id,
              status: products[0].productStatus,
              skuCount: products[0].skus?.length,
            }
          : 'none',
      });
      throw new Error(
        'No products with purchasable SKUs found. Ensure products are published and have SKUs.'
      );
    }

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
        price: sku.price, // Liferay expects 'price'
        unitPrice: sku.price, // Keep for backward compatibility
      });
    }

    return {
      accountExternalReferenceCode: account.externalReferenceCode,
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
    sessionId,
    config,
    options,
    orderDataList,
    accounts,
    products
  ) {
    const batchId = `orders-individual-${Date.now()}`;
    const batchERC = createERC(ERC_PREFIX.ORDER_BATCH);

    this.progress.batchStarted({
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

        this.progress.batchProgress(
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
      }
    }

    this.progress.batchCompleted(
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

    await this.completeSyncStep(
      sessionId,
      S.CREATE_ORDERS,
      'SYNCHRONOUS',
      created.length,
      orderDataList.length
    );

    return {
      orders: created,
      created: created.length,
      errors,
      success: errors.length === 0,
    };
  }

  pickAccount(requestedId, accounts) {
    if (requestedId) {
      const found = accounts.find((a) => a.id === requestedId);
      if (found) return found;
    }
    if (accounts.length === 0)
      throw new Error('No accounts found to pick from.');
    return accounts[Math.floor(Math.random() * accounts.length)];
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

  async getProductsAndAccounts(config, context = {}) {
    let products = [];
    let accounts = [];
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts && products.length === 0) {
      if (attempts > 0) {
        this.logger.debug(
          `Retry ${attempts}/${maxAttempts} fetching products for orders...`,
          { sessionId: config.sessionId }
        );
        const retryDelayMs = 5000;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }

      const productsRes = await this.liferay.getProductsWithSkus(config, {
        catalogId: config.catalogId,
      });
      products = productsRes.items || [];
      attempts++;
    }

    if (
      context.accountsToCreate &&
      context.accountsToCreate.length > 0 &&
      context.accountsToCreate.every((a) => a.id)
    ) {
      accounts = context.accountsToCreate;
      this.logger.debug(
        `Using ${accounts.length} newly created accounts for orders.`
      );
    } else {
      this.logger.debug(
        'Fetching existing accounts from Liferay for order assignment...'
      );
      const accountsRes = await this.liferay.getAccounts(config, {
        channelId: config.channelId,
      });
      accounts = accountsRes.items || [];
      this.logger.debug(`Found ${accounts.length} existing accounts.`);
    }

    return { products, accounts };
  }

  async handleBatchCallback(sessionId, batchERC) {
    this.logger.debug(
      `Batch callback received for order generation session ${sessionId}`,
      { batchERC }
    );
    return true;
  }
}

module.exports = OrderGenerator;
