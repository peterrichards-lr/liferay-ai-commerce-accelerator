const { delay, resolvePhaseAndMode } = require('../utils/misc.cjs');
const { PATH } = require('../utils/liferayPaths.cjs');

class OrderGenerator {
  constructor(ctx) {
    this.ctx = ctx;
  }

  validateConfig(config) {
    const prVal = config.pollingRetries;
    if (prVal === undefined || prVal === null)
      throw new Error('pollingRetries is required');
    const pr = parseInt(prVal);
    if (isNaN(pr) || pr < 0 || pr > 20)
      throw new Error('pollingRetries must be between 0 and 20');

    const pdVal = config.pollingDelay;
    if (pdVal === undefined || pdVal === null)
      throw new Error('pollingDelay is required');
    const pd = parseInt(pdVal);
    if (isNaN(pd) || pd < 5000 || pd > 600000)
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

  async submitOrdersBatch(config, items, callbackUrl) {
    const { logger, liferay } = this.ctx;
    const payload = { createStrategy: 'INSERT', items };
    const url = PATH.ORDERS_BATCH(callbackUrl);

    logger.info('Sending batch order creation request', {
      operation: 'create-orders-batch',
      orderCount: items.length,
      callbackUrl: callbackUrl || 'none',
      url,
    });

    const data = await liferay._post(
      config,
      url,
      payload,
      'create-orders-batch',
      'Failed to create orders batch'
    );

    const batchId = data.id || `batch-${Date.now()}`;
    const status = data.status || 'submitted';

    logger.info('Batch order creation initiated', {
      operation: 'create-orders-batch',
      batchId,
      status,
    });

    return { batchId, status, orderCount: items.length };
  }

  buildOrderPayload(config, orderData, accounts) {
    const accountId = this.pickAccountId(orderData.accountId, accounts);
    const orderStatus = this.normalizeOrderStatus(orderData.orderStatus);
    return {
      accountId,
      channelId: parseInt(config.channelId, 10),
      currencyCode: config.currencyCode,
      orderDate: orderData.orderDate || new Date().toISOString(),
      orderStatus: parseInt(orderStatus, 10),
      externalReferenceCode:
        orderData.externalReferenceCode ||
        `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  }

  async generateOrders(config, options) {
    const { ai, logger, mockData, cache, batchPolling, getWs, liferay } =
      this.ctx;

    const correlationId = config.correlationId;
    const useBatch = config.batchSize > 1 && options.orderCount > 1;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch,
      phase: 'generate',
    });

    logger.info('Starting order generation', {
      correlationId,
      operation: 'orders/generate:start',
      orderCount: options.orderCount,
      mode,
      phase,
      demoMode: options.demoMode,
      batchSize: config.batchSize,
      pollingDelay: config.pollingDelay,
      pollingRetries: config.pollingRetries,
    });

    const results = { orders: [], created: 0, errors: [] };

    try {
      this.validateConfig(config);
      await this.validateOptions(options);

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

      if (useBatch) {
        const callbackUrl =
          config.microserviceUrl && config.microserviceUrl !== 'null'
            ? `${config.microserviceUrl}/api/batch/callback`
            : null;

        const chunks = [];
        for (let i = 0; i < orderDataList.length; i += config.batchSize) {
          chunks.push(orderDataList.slice(i, i + config.batchSize));
        }

        for (let batchIndex = 0; batchIndex < chunks.length; batchIndex++) {
          const originalBatch = chunks[batchIndex];

          const liferayOrders = originalBatch.map((od) =>
            this.buildOrderPayload(config, od, accounts)
          );

          const submission = await this.submitOrdersBatch(
            config,
            liferayOrders,
            callbackUrl
          );

          const startedAt = Date.now();
          cache.set(
            `batch:${submission.batchId}:meta`,
            { totalCount: liferayOrders.length, startedAt },
            3600000
          );

          getWs().emitBatchStarted(
            {
              batchId: submission.batchId,
              entityType: 'orders',
              totalItems: liferayOrders.length,
              operation: 'generate',
              mode,
              phase,
            },
            { correlationId }
          );

          cache.set(
            `batch:${submission.batchId}:config`,
            {
              correlationId,
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              createdAt: new Date().toISOString(),
              entityType: 'orders',
              liferayUrl: config.liferayUrl,
              localeCode: config.localeCode,
              operation: 'generate',
              pollInterval: config.pollingDelay || 5000,
              maxPollAttempts: config.pollingRetries || 120,
              mode,
            },
            3600000
          );

          const pollInterval = Math.max(config.pollingDelay || 5000, 2000);
          const maxPollAttempts = config.pollingRetries || 120;

          batchPolling.startPolling(
            submission.batchId,
            {
              liferayUrl: config.liferayUrl,
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              localeCode: config.localeCode,
              entityType: 'orders',
            },
            {
              pollInterval,
              maxPollAttempts,
              entityType: 'orders',
              mode,
              affectsProgress: true,
              onStatusChange: (status) => {
                const meta =
                  cache.get(`batch:${submission.batchId}:meta`) || {};
                const total =
                  status.totalCount ||
                  meta.totalCount ||
                  liferayOrders.length ||
                  0;
                const processed = status.processedCount || 0;
                const progress =
                  total > 0 ? Math.round((processed / total) * 100) : 0;
                const elapsedMs = Math.max(
                  1,
                  Date.now() - (meta.startedAt || Date.now())
                );
                const rate = processed / (elapsedMs / 1000);
                const remaining = Math.max(0, total - processed);
                const etaSeconds =
                  rate > 0 ? Math.round(remaining / rate) : null;

                getWs().emitBatchProgress(
                  {
                    batchId: status.batchId,
                    entityType: 'orders',
                    completedCount: processed,
                    totalItems: total,
                    progress,
                    etaSeconds,
                    operation: 'generate',
                    mode,
                    phase,
                  },
                  { correlationId }
                );

                logger.debug('Orders batch status update', {
                  operation: 'orders/batch:progress',
                  batchId: status.batchId,
                  status: status.status,
                  processedCount: processed,
                  totalCount: total,
                  progress,
                  etaSeconds,
                });
              },
              onComplete: (r) => this.handleBatchComplete(r, config),
              onError: (error) => {
                logger.error('Orders batch polling error', {
                  operation: 'orders/batch:error',
                  batchId: submission.batchId,
                  error: error.message,
                  entityType: 'orders',
                });

                getWs().emitBatchFailed(
                  {
                    batchId: submission.batchId,
                    entityType: 'orders',
                    error: error.message || 'Batch polling error',
                    successCount: 0,
                    failureCount: 1,
                    operation: 'generate',
                    mode,
                    phase,
                  },
                  { correlationId }
                );
              },
            }
          );

          logger.info('Orders batch submission completed', {
            operation: 'orders/batch:submit',
            batchId: submission.batchId,
            orderCount: liferayOrders.length,
            status: submission.status,
            callbackUrl: callbackUrl || 'none',
            mode,
            phase,
          });

          results.orders.push({
            batchIndex: batchIndex + 1,
            totalBatches: chunks.length,
            batchId: submission.batchId,
            status: submission.status,
            orderCount: liferayOrders.length,
            orders: liferayOrders.map((o) => ({
              accountId: o.accountId,
              erc: o.externalReferenceCode,
            })),
          });
          results.created += liferayOrders.length;

          if (batchIndex < chunks.length - 1) await delay(1000);
        }

        return {
          orders: results.orders,
          created: results.created,
          errors: results.errors,
          success: results.errors.length === 0,
        };
      }

      return await this.generateOrdersIndividually(
        config,
        options,
        orderDataList,
        accounts
      );
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

  async generateOrdersIndividually(config, options, orderDataList, accounts) {
    const { logger, getWs } = this.ctx;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: false,
      phase: 'generate',
    });

    const startedAt = Date.now();
    const metaKey = 'orders-individual:meta';
    this.ctx.cache.set(
      metaKey,
      { total: orderDataList.length, startedAt },
      3600000
    );

    getWs().emitBatchStarted(
      {
        batchId: 'orders-individual',
        entityType: 'orders',
        totalItems: orderDataList.length,
        operation: 'generate',
        mode,
        phase,
      },
      { correlationId: config.correlationId }
    );

    const created = [];
    const errors = [];

    for (let i = 0; i < orderDataList.length; i++) {
      try {
        const payload = this.buildOrderPayload(
          config,
          orderDataList[i],
          accounts
        );
        const createdOrder = await this.createSingleOrder(config, payload);
        created.push(createdOrder);

        const processed = i + 1;
        const total = orderDataList.length;
        const progress = Math.round((processed / total) * 100);
        const meta = this.ctx.cache.get(metaKey) || { startedAt };
        const elapsedMs = Math.max(
          1,
          Date.now() - (meta.startedAt || Date.now())
        );
        const rate = processed / (elapsedMs / 1000);
        const remaining = Math.max(0, total - processed);
        const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;

        getWs().emitBatchProgress(
          {
            batchId: 'orders-individual',
            entityType: 'orders',
            completedCount: processed,
            totalItems: total,
            progress,
            etaSeconds,
            operation: 'generate',
            mode,
            phase,
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

    getWs().emitBatchCompleted(
      {
        batchId: 'orders-individual',
        entityType: 'orders',
        successCount: created.length,
        failureCount: errors.length,
        errors: errors.slice(0, 5),
        operation: 'generate',
        mode,
        phase,
      },
      { correlationId: config.correlationId }
    );

    logger.info('Order generation completed', {
      correlationId: config.correlationId,
      operation: 'orders/generate:complete',
      created: created.length,
      errors: errors.length,
      mode: options.demoMode ? 'demo' : 'live',
    });

    return {
      orders: created,
      created: created.length,
      errors,
      success: errors.length === 0,
    };
  }

  async createSingleOrder(config, liferayOrderPayload) {
    const { liferay, logger } = this.ctx;

    const isRetryable = (e) => {
      const msg = String(e && e.message ? e.message : e);
      return /(429|5\d\d|ETIMEDOUT|ECONNRESET|EAI_AGAIN)/i.test(msg);
    };

    const createdOrder = await this.withRetry(
      async () => liferay.createOrder(config, liferayOrderPayload),
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

  handleBatchComplete(results, config) {
    const { logger, getWs } = this.ctx;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: true,
      phase: 'complete',
    });

    logger.info('Handling orders batch completion', {
      operation: 'orders/batch:complete',
      batchId: results.batchId,
      status: results.status,
      processedCount: results.processedCount,
      totalCount: results.totalCount,
    });

    const content = results.content;
    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    if (Array.isArray(content)) {
      content.forEach((item, index) => {
        if (item.status === 'SUCCESS' || item.status === 'CREATED') {
          successCount++;
        } else {
          failureCount++;
          failures.push({
            index,
            error: item.error || item.message || 'Unknown error',
          });
        }
      });
    } else {
      successCount = results.processedCount || results.totalCount || 0;
    }

    getWs().emitBatchCompleted(
      {
        batchId: results.batchId,
        entityType: 'orders',
        successCount,
        failureCount,
        errors: failures.slice(0, 5),
        operation: 'generate',
        mode,
        phase,
      },
      { correlationId: config.correlationId }
    );
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
}

module.exports = OrderGenerator;
