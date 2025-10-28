const { delay, resolvePhaseAndMode } = require('../utils/misc.cjs');

class OrderGenerator {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async generateOrders(config, options) {
    const { ai, logger, mockData, batchProcessor, getWs, cache } = this.ctx;
    const correlationId = config.correlationId;
    const useConcurrent = config.batchSize > 1 && options.orderCount > 1;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: useConcurrent,
      phase: 'generate',
    });
    const startedAt = Date.now();
    const results = { orders: [], created: 0, errors: [] };

    try {
      this.validateConfig(config);
      await this.validateOptions(options);

      logger.info('Starting order generation', {
        correlationId,
        operation: 'orders/generate:start',
        orderCount: options.orderCount,
        mode,
        useConcurrent,
        batchSize: config.batchSize,
        pollingDelay: config.pollingDelay,
        pollingRetries: config.pollingRetries,
      });

      const { products, accounts } = await this.getProductsAndAccountsWithRetry(
        config
      );

      let orderDataList;
      if (options.demoMode) {
        orderDataList = mockData.generateOrderData(options.orderCount);
      } else {
        orderDataList = await ai.generateOrderData(
          options.orderCount,
          products,
          accounts,
          config.aiModel || 'gpt-4o'
        );
      }

      const batchId = useConcurrent
        ? `orders-concurrent-${Date.now()}`
        : 'orders-individual';

      cache.set(
        `batch:${batchId}:meta`,
        { totalCount: orderDataList.length, startedAt },
        3600000
      );

      getWs().emitBatchStarted(
        {
          batchId,
          entityType: 'orders',
          totalItems: orderDataList.length,
          operation: 'generate',
          mode,
          phase,
        },
        { correlationId }
      );

      if (useConcurrent) {
        let completed = 0;
        const failures = [];
        await batchProcessor.processBatchWithProgress(
          orderDataList,
          async (orderData) => {
            const createdOrder = await this.createSingleOrder(
              config,
              orderData,
              products,
              accounts
            );
            results.orders.push(createdOrder);
            results.created++;
            return createdOrder;
          },
          config.batchSize,
          (progress) => {
            getWs().emitBatchProgress(
              {
                batchId,
                entityType: 'orders',
                completedCount: progress.processed,
                totalItems: progress.total,
                progress: progress.percentage,
                operation: 'generate',
                meta: progress.meta, // ← normalized (totalClients/sent/failed)
              },
              { correlationId }
            );
          },
          {
            operation: 'generate-orders',
            broadcastMeta: { batchId, entityType: 'orders' },
          }
        );
      } else {
        let completed = 0;
        for (const orderData of orderDataList) {
          try {
            const createdOrder = await this.createSingleOrder(
              config,
              orderData,
              products,
              accounts
            );
            results.orders.push(createdOrder);
            results.created++;
          } catch (e) {
            results.errors.push({
              externalReferenceCode: orderData.externalReferenceCode,
              error: e.message,
            });
          } finally {
            completed++;
            const meta = cache.get(`batch:${batchId}:meta`) || {
              startedAt,
              totalCount: orderDataList.length,
            };
            const total = meta.totalCount || orderDataList.length;
            const progress = Math.round((completed / total) * 100);
            const elapsedMs = Math.max(
              1,
              Date.now() - (meta.startedAt || startedAt)
            );
            const rate = completed / (elapsedMs / 1000);
            const remaining = Math.max(0, total - completed);
            const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;

            getWs().emitBatchProgress(
              {
                batchId,
                entityType: 'orders',
                completedCount: completed,
                totalItems: total,
                progress,
                etaSeconds,
                operation: 'generate',
                mode,
                phase,
              },
              { correlationId }
            );
          }
        }
      }

      const durationMs = Date.now() - startedAt;

      getWs().emitBatchCompleted(
        {
          batchId,
          entityType: 'orders',
          successCount: results.created,
          failureCount: results.errors.length,
          errors: results.errors.slice(0, 5),
          operation: 'generate',
          mode,
          phase,
          meta: { durationMs, startedAt },
        },
        { correlationId }
      );

      logger.info('Order generation completed', {
        correlationId,
        operation: 'orders/generate:complete',
        created: results.created,
        errors: results.errors.length,
        durationMs,
      });

      return { ...results, success: results.errors.length === 0 };
    } catch (error) {
      logger.error('Order generation failed', {
        correlationId,
        operation: 'orders/generate:error',
        error: error.message,
        mode,
        phase,
      });
      throw error;
    }
  }

  async createSingleOrder(
    config,
    orderData,
    availableProducts,
    availableAccounts
  ) {
    const { liferay, logger } = this.ctx;
    const accountId = this.pickAccountId(
      orderData.accountId,
      availableAccounts
    );
    const orderStatus = this.normalizeOrderStatus(orderData.orderStatus);
    const liferayOrder = {
      accountId,
      channelId: parseInt(config.channelId),
      currencyCode: config.currencyCode,
      orderDate: orderData.orderDate || new Date().toISOString(),
      orderStatus: parseInt(orderStatus),
      externalReferenceCode:
        orderData.externalReferenceCode ||
        `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
    const isRetryable = (e) => {
      const msg = String(e && e.message ? e.message : e);
      return /(429|5\d\d|ETIMEDOUT|ECONNRESET|EAI_AGAIN)/i.test(msg);
    };
    const createdOrder = await this.withRetry(
      async () => liferay.createOrder(config, liferayOrder),
      isRetryable,
      3,
      600
    );
    logger.trace('Created order', {
      operation: 'orders/create:success',
      erc: createdOrder.externalReferenceCode,
    });
    return createdOrder;
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

  async withRetry(fn, isRetryable, attempts = 3, baseMs = 500) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e) || i === attempts - 1) throw e;
        const jitter = Math.floor(Math.random() * 150);
        await delay(baseMs * Math.pow(2, i) + jitter);
      }
    }
    throw lastErr;
  }

  async getProductsAndAccountsWithRetry(config) {
    const { liferay, logger } = this.ctx;
    for (let attempt = 0; attempt <= config.pollingRetries; attempt++) {
      try {
        const products = await liferay.getProducts(config, config.catalogId);
        const accounts = await liferay.getAccounts(config);
        if (products.length === 0) {
          if (attempt < config.pollingRetries) {
            await delay(config.pollingDelay);
            continue;
          } else {
            throw new Error(
              'No products available. Please generate products first.'
            );
          }
        }
        if (accounts.length === 0) {
          if (attempt < config.pollingRetries) {
            await delay(config.pollingDelay);
            continue;
          } else {
            throw new Error(
              'No accounts available. Please generate accounts first.'
            );
          }
        }
        logger.trace('Dependencies ready', {
          operation: 'orders/dependencies:ready',
          products: products.length,
          accounts: accounts.length,
        });
        return { products, accounts };
      } catch (error) {
        const msg = String(error && error.message ? error.message : error);
        const retryable = /No products available|No accounts available/.test(
          msg
        );
        if (attempt < config.pollingRetries && retryable) {
          await delay(config.pollingDelay);
          continue;
        }
        throw error;
      }
    }
  }

  async addOrderItems(config, orderId, orderItems, availableProducts) {
    const { logger } = this.ctx;
    for (const item of orderItems) {
      const product = availableProducts.find(
        (p) => p.sku === item.sku || p.id === item.productId
      );
      if (!product) {
        logger.warn('Order item product not found', {
          operation: 'orders/add-item:missing',
          sku: item.sku,
          productId: item.productId,
        });
        continue;
      }
    }
  }

  validateConfig(config) {
    const pr = parseInt(config.pollingRetries);
    if (!Number.isFinite(pr) || pr < 0 || pr > 20)
      throw new Error('pollingRetries must be between 0 and 20');
    const pd = parseInt(config.pollingDelay);
    if (!Number.isFinite(pd) || pd < 5000 || pd > 600000)
      throw new Error('pollingDelay must be between 5 and 600 seconds');
    const ch = parseInt(config.channelId);
    if (!Number.isFinite(ch) || ch <= 0)
      throw new Error('channelId must be a positive integer');
    if (!config.currencyCode) throw new Error('currencyCode is required');
  }

  async validateOptions(options) {
    const { ai } = this.ctx;
    if (
      !options.orderCount ||
      typeof options.orderCount !== 'number' ||
      options.orderCount <= 0
    ) {
      throw new Error('orderCount must be greater than 0');
    }
    if (!options.demoMode) {
      await ai.getOpenAIClient();
    }
  }
}

module.exports = OrderGenerator;
