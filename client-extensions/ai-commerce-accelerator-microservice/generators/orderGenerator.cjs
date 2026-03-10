const BaseGenerator = require('./baseGenerator.cjs');
const {
  delay,
  resolvePhaseAndMode,
  createERC,
  isoNow,
  now,
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
    };
  }

  async generateOrders(config, options) {
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

    const steps = [
      { 
        name: S.GENERATE_ORDER_DATA, 
        type: 'sync',
        dependsOn: [S.CREATE_PRODUCTS, S.CREATE_ACCOUNTS]
      },
      { name: S.CREATE_ORDERS, type: 'sync' },
    ];

    await this.persistence.createSession({
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

    this.ctx.batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    this.logger.info('Order generation workflow started', {
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

      const orderDataList = await this.ctx.generation.generate(
        'order',
        options.orderCount,
        config,
        {
          ...options,
          products,
          accounts
        }
      );

      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        orderDataList,
        products,
        accounts,
      });

      await this.completeSyncStep(sessionId, S.GENERATE_ORDER_DATA, 'SYNCHRONOUS', orderDataList.length, orderDataList.length);
    } catch (error) {
      this.logger.error('Failed execution of generate-order-data step', {
        sessionId,
        correlationId: session.correlationId,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_ORDER_DATA,
        status: 'FAILED',
      });
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
        return await this.completeSyncStep(sessionId, S.CREATE_ORDERS, 'BYPASSED');
      }

      const batchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
      const useBatch = batchSize > 1 && options.orderCount > 1;

      if (useBatch) {
        const chunks = [];
        for (let i = 0; i < orderDataList.length; i += batchSize) {
          chunks.push(orderDataList.slice(i, i + batchSize));
        }

        if (options.dryRun) {
          return await this.completeSyncStep(sessionId, S.CREATE_ORDERS, 'SYNCHRONOUS', orderDataList.length, orderDataList.length);
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
            (erc) => this.liferay.createOrdersBatch(config, batch, {
              externalReferenceCode: erc,
            }),
            batch.length
          );
        }
      } else {
        if (options.dryRun) {
          return await this.completeSyncStep(sessionId, S.CREATE_ORDERS, 'SYNCHRONOUS', orderDataList.length, orderDataList.length);
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
      this.logger.error('Failed execution of create-orders step', {
        sessionId,
        correlationId: session.correlationId,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.CREATE_ORDERS,
        status: 'FAILED',
      });
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
      this.logger.error('Failed to create single order', { error: error.message });
      throw error;
    }
  }

  buildOrderPayload(config, orderData, accounts, products, warehouses) {
    const accountId = this.pickAccountId(orderData.accountId, accounts);
    const orderStatus = this.normalizeOrderStatus(orderData.orderStatus);

    const orderItems = [];
    const itemCount = Math.floor(Math.random() * 3) + 1;

    const allPurchasableSkus = products.flatMap((p) =>
      (p.skus || []).filter((s) => s.purchasable && s.sku && p.productStatus === 0)
    );

    if (allPurchasableSkus.length === 0) {
      throw new Error('No products with purchasable SKUs found.');
    }

    for (let i = 0; i < itemCount; i++) {
      const sku = allPurchasableSkus[i % allPurchasableSkus.length];
      const warehouse = warehouses && warehouses.length > 0
          ? warehouses[Math.floor(Math.random() * warehouses.length)]
          : null;

      orderItems.push({
        sku: sku.sku,
        skuExternalReferenceCode: sku.sku,
        quantity: Math.floor(Math.random() * 3) + 1,
        warehouseId: warehouse ? warehouse.id : undefined,
        unitPrice: sku.price,
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
        const payload = this.buildOrderPayload(config, orderDataList[i], accounts, products, options.warehouses);
        const createdOrder = await this.createSingleOrder(config, payload);
        created.push(createdOrder);

        this.progress.batchProgress({
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

    this.progress.batchCompleted({
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

    await this.completeSyncStep(sessionId, S.CREATE_ORDERS, 'SYNCHRONOUS', created.length, orderDataList.length);

    return { orders: created, created: created.length, errors, success: errors.length === 0 };
  }

  pickAccountId(requestedId, accounts) {
    if (requestedId && accounts.find((a) => a.id === requestedId)) return requestedId;
    return accounts[Math.floor(Math.random() * accounts.length)].id;
  }

  normalizeOrderStatus(s) {
    if (typeof s === 'number') return s;
    const m = { open: 0, pending: 0, 'in-progress': 1, processing: 1, shipped: 2, delivered: 10, completed: 10, cancelled: 15, canceled: 15 };
    return m[(s || '').toLowerCase()] ?? 0;
  }

  async getProductsAndAccounts(config, context = {}) {
    const productsRes = await this.liferay.getProducts(config, { catalogId: config.catalogId });
    let accounts = [];
    if (context.accountsToCreate && context.accountsToCreate.every((a) => a.id)) {
      accounts = context.accountsToCreate;
    } else {
      const accountsRes = await this.liferay.getAccounts(config, { channelId: config.channelId });
      accounts = accountsRes.items || [];
    }
    const products = productsRes.items || [];
    return { products, accounts };
  }
}

module.exports = OrderGenerator;
