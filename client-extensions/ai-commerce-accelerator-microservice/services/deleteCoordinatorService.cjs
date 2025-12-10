const { getBatchCacheTTLms, MIN } = require('../utils/ttl.cjs');

class DeleteCoordinatorService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  _extractIdFromLocation(location) {
    if (!location) return null;
    const s = String(location);

    const m =
      s.match(/\/batch-engine\/(?:import-task|export-task|task)\/(\d+)\b/) ||
      s.match(/\/(?:import-task|export-task|task)\/(\d+)\b/);

    return m ? m[1] : null;
  }

  _normalizeBatchId(ref) {
    if (ref == null) return null;
    if (typeof ref === 'string' || typeof ref === 'number') return String(ref);
    return (
      ref?.taskId ||
      ref?.id ||
      this._extractIdFromLocation(ref?.location) ||
      ref?.batchId ||
      null
    );
  }

  _deriveTotalFromResult(result) {
    if (!result) return 0;
    const candidates = [
      result.totalCount,
      result.count,
      result.total,
      Array.isArray(result.items) ? result.items.length : undefined,
      Array.isArray(result.ids) ? result.ids.length : undefined,
      Array.isArray(result.targets) ? result.targets.length : undefined,
      Array.isArray(result.toDelete) ? result.toDelete.length : undefined,
      Array.isArray(result.entities) ? result.entities.length : undefined,
    ].filter((v) => Number.isFinite(v) && v >= 0);

    if (candidates.length > 0) return candidates[0];
    if (result.summary && Number.isFinite(result.summary.total)) {
      return result.summary.total;
    }
    return 0;
  }

  recordBatches(batchRefs, config, entityType, totalCount) {
    const { logger, cache, configService } = this.ctx;
    const refs = Array.isArray(batchRefs)
      ? batchRefs
      : batchRefs
      ? [batchRefs]
      : [];
    if (refs.length === 0) return;
    for (const ref of refs) {
      const batchId = this._normalizeBatchId(ref);
      if (!batchId) {
        logger.warn('Unable to determine batchId from reference', {
          operation: 'batch-config-store-missing-id',
          entityType,
          ref,
        });
        continue;
      }

      cache.set(
        `batch:${batchId}:config`,
        {
          affectsProgress: true,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          correlationId: config.correlationId || null,
          createdAt: new Date().toISOString(),
          entityType,
          liferayUrl: config.liferayUrl,
          localeCode: config.localeCode,
          operation: 'delete',
          totalCount: Number.isFinite(totalCount) ? totalCount : 0,
          pollInterval: config.pollInterval || 5000,
          maxPollAttempts: config.maxPollAttempts || 120,
          mode: 'delete',
        },
        MIN(90)
      );

      logger.info('Batch config stored', {
        operation: 'batch-config-store',
        batchId,
        entityType,
        totalCount: Number.isFinite(totalCount) ? totalCount : 0,
      });
    }
  }

  async _waitForBatches(refs, config, entityType) {
    const { logger, batchPolling } = this.ctx;
    const batchIds = (Array.isArray(refs) ? refs : refs ? [refs] : [])
      .map((r) => this._normalizeBatchId(r))
      .filter(Boolean);
    if (batchIds.length === 0) return;

    const pollInterval = Number(config.pollInterval) || 5000;
    const maxPollAttempts = Number(config.maxPollAttempts) || 120;

    for (const bid of batchIds) {
      await new Promise((resolve) => {
        const started = Date.now();
        batchPolling.startPolling(
          String(bid),
          {
            liferayUrl: config.liferayUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            localeCode: config.localeCode,
            entityType,
          },
          {
            pollInterval,
            maxPollAttempts,
            timeoutMs: maxPollAttempts * pollInterval * 1.5,
            onTimeout: () => {
              logger.warn(`Delete ${entityType} batch timed out`, {
                batchId: String(bid),
              });
              resolve();
            },
            onStatusChange: () => {},
            onComplete: (r) => {
              const elapsedMs = Date.now() - started;
              logger.info(`Delete ${entityType} batch complete`, {
                batchId: String(bid),
                status: r.status,
                processedCount: r.processedCount,
                totalCount: r.totalCount,
                elapsedMs,
              });
              resolve();
            },
            onError: (e) => {
              logger.error(`Delete ${entityType} batch polling error`, {
                batchId: String(bid),
                error: e.message,
              });
              resolve();
            },
            entityType,
            operation: 'delete',
            mode: 'batch',
            affectsProgress: true,
          }
        );
      });
    }
  }

  async runDeleteAndMonitorV2(config, options = {}) {
    const { liferay, logger, cache, configService } = this.ctx;

    const baseOpts = {
      ...options,
      importStrategy: options.importStrategy || 'ON_ERROR_CONTINUE',
    };

    const batchERC = `AICA-DEL-ALL-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 10)}`;

    const callbackUrl =
      config.microserviceUrl && config.microserviceUrl !== 'null'
        ? `${config.microserviceUrl}/api/batch/callback?batchERC=${batchERC}&opCode=D`
        : null;

    if (!callbackUrl) {
      logger.warn(
        'Microservice URL not configured, cannot use callback-based deletion. Falling back to polling.',
        { operation: 'runDeleteAndMonitorV2' }
      );

      return this.runDeleteAndMonitor(config, options);
    }

    const context = {
      config,
      options: baseOpts,
      callbackUrl,
      batchERC,
      steps: [
        'orders',
        'accounts',
        'products',
        'specifications',
        'options',
        'optionCategories',
      ],
      currentStep: 'orders',
    };

    cache.set(
      `batch:${batchERC}:context`,
      context,
      getBatchCacheTTLms(configService)
    );

    logger.info('Starting chained deletion process', {
      batchERC,
      step: 'orders',
    });

    const existingOrders = await liferay.getCommerceOrders(config, {
      pageSize: 1,
    });

    if (existingOrders?.items?.length > 0) {
      const orders = await liferay.deleteCommerceOrders(
        config,
        { ...baseOpts, callbackBatchERC: batchERC },
        `${callbackUrl}&entity=orders`
      );

      if (orders?.batchRefs) {
        this.recordBatches(
          orders.batchRefs,
          config,
          'orders',
          this._deriveTotalFromResult(orders)
        );
      }

      return { orders };
    } else {
      logger.info(
        'Skipping order deletion: No orders found. Triggering next step directly.',
        { operation: 'runDeleteAndMonitorV2' }
      );
      await this.ctx.batchCallbackService.processCallback(batchERC, {
        entity: 'orders',
        status: 'completed',
      });
      return {
        orders: {
          total: 0,
          batches: 0,
          submitted: 0,
          dryRun: false,
          batchRefs: [],
        },
      };
    }
  }

  async runDeleteSelectedAndMonitorV2(
    config,
    options = {},
    { channelId, catalogId }
  ) {
    const { liferay, logger, cache, configService } = this.ctx;

    const baseOpts = {
      ...options,
      importStrategy: options.importStrategy || 'ON_ERROR_CONTINUE',
    };

    const batchERC = `AICA-DEL-SEL-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 10)}`;

    const callbackUrl =
      config.microserviceUrl && config.microserviceUrl !== 'null'
        ? `${config.microserviceUrl}/api/batch/callback?batchERC=${batchERC}&opCode=D`
        : null;

    if (!callbackUrl) {
      logger.warn(
        'Microservice URL not configured, cannot use callback-based deletion. Falling back to polling.',
        { operation: 'runDeleteSelectedAndMonitorV2' }
      );
      return this.runDeleteSelectedAndMonitor(config, options);
    }

    const context = {
      config,
      options: baseOpts,
      callbackUrl,
      batchERC,
      steps: [
        'orders',
        'accounts',
        'products',
        'specifications',
        'options',
        'optionCategories',
      ],
      currentStep: 'orders',
      channelId,
      catalogId,
    };

    cache.set(
      `batch:${batchERC}:context`,
      context,
      getBatchCacheTTLms(configService)
    );

    logger.info('Starting chained deletion process for selected data', {
      batchERC,
      step: 'orders',
      channelId,
    });

    const existingOrders = await liferay.getCommerceOrders(config, {
      channelId,
      pageSize: 1,
    });

    if (existingOrders?.items?.length > 0) {
      const orders = await liferay.deleteCommerceOrders(
        config,
        { ...baseOpts, channelId, callbackBatchERC: batchERC },
        `${callbackUrl}&entity=orders`
      );

      if (orders?.batchRefs) {
        this.recordBatches(
          orders.batchRefs,
          config,
          'orders',
          this._deriveTotalFromResult(orders)
        );
      }

      return { orders };
    } else {
      logger.info(
        'Skipping order deletion: No orders found for channel. Triggering next step directly.',
        { operation: 'runDeleteSelectedAndMonitorV2', channelId }
      );
      await this.ctx.batchCallbackService.processCallback(batchERC, {
        entity: 'orders',
        status: 'completed',
      });
      return {
        orders: {
          total: 0,
          batches: 0,
          submitted: 0,
          dryRun: false,
          batchRefs: [],
        },
      };
    }
  }

  async _listOptionCategories(config, { search, pageSize = 200 } = {}) {
    const { logger, liferay } = this.ctx;
    try {
      if (liferay.getOptionCategories) {
        return await liferay.getOptionCategories(config, {
          search,
          pageSize,
          fields: 'id,key',
        });
      }
    } catch (e) {
      logger.debug(
        'getOptionCategories via client failed; falling back to HTTP',
        { error: e.message }
      );
    }
    if (!liferay.httpGet) {
      logger.debug(
        'No httpGet on liferay client; cannot list option categories'
      );
      return { items: [] };
    }
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('page', '1');
    params.set('pageSize', String(pageSize));
    params.set('fields', 'id,key');
    const url = `/o/headless-commerce-admin-catalog/v1.0/optionCategories?${params.toString()}`;
    const res = await liferay.httpGet(config, url);
    return res || { items: [] };
  }

  async runDeleteAndMonitor(config, options = {}) {
    const { liferay, logger } = this.ctx;

    const baseOpts = {
      ...options,
      importStrategy: options.importStrategy || 'ON_ERROR_CONTINUE',
    };
    const callbackUrl =
      config.microserviceUrl && config.microserviceUrl !== 'null'
        ? `${config.microserviceUrl}/api/batch/callback`
        : null;

    let orders, accounts, products;

    const existingOrders = await liferay.getCommerceOrders(config, {
      pageSize: 1,
    });

    if (existingOrders?.items?.length > 0) {
      orders = await liferay.deleteCommerceOrders(
        config,
        baseOpts,
        callbackUrl
      );
      if (orders?.batchRefs) {
        this.recordBatches(
          orders.batchRefs,
          config,
          'orders',
          this._deriveTotalFromResult(orders)
        );
      }
      await this._waitForBatches(orders?.batchRefs, config, 'orders');
    } else {
      logger.info('Skipping order deletion: No orders found.', {
        operation: 'runDeleteAndMonitor',
      });
    }

    const existingAccounts = await liferay.getCommerceAccounts(config, {
      pageSize: 1,
    });

    if (existingAccounts?.items?.length > 0) {
      accounts = await liferay.deleteCommerceAccounts(
        config,
        baseOpts,
        callbackUrl
      );
      if (accounts?.batchRefs) {
        this.recordBatches(
          accounts.batchRefs,
          config,
          'accounts',
          this._deriveTotalFromResult(accounts)
        );
      }
      await this._waitForBatches(accounts?.batchRefs, config, 'accounts');
    } else {
      logger.info('Skipping account deletion: No accounts found.', {
        operation: 'runDeleteAndMonitor',
      });
    }

    const existingProducts = await liferay.getCommerceProducts(config, {
      pageSize: 1,
    });

    if (existingProducts?.items?.length > 0) {
      products = await liferay.deleteCommerceProducts(
        config,
        baseOpts,
        callbackUrl
      );
      if (products?.batchRefs) {
        this.recordBatches(
          products.batchRefs,
          config,
          'products',
          this._deriveTotalFromResult(products)
        );
      }
      await this._waitForBatches(products?.batchRefs, config, 'products');
    } else {
      logger.info('Skipping product deletion: No products found.', {
        operation: 'runDeleteAndMonitor',
      });
    }

    await new Promise((r) => setTimeout(r, 1500));

    let specifications, optionsRes;

    const existingSpecifications = await liferay.getSpecifications(config, {
      pageSize: 1,
    });

    if (existingSpecifications?.items?.length > 0) {
      specifications = await liferay.deleteSpecificationsBatch(
        config,
        { ...baseOpts, all: true },
        callbackUrl
      );
      if (specifications?.batchRefs) {
        this.recordBatches(
          specifications.batchRefs,
          config,
          'specifications',
          this._deriveTotalFromResult(specifications)
        );
      }
      await this._waitForBatches(
        specifications?.batchRefs,
        config,
        'specifications'
      );
    } else {
      logger.info('Skipping specification deletion: No specifications found.', {
        operation: 'runDeleteAndMonitor',
      });
    }

    const existingOptions = await liferay.getOptions(config, { pageSize: 1 });

    if (existingOptions?.items?.length > 0) {
      optionsRes = await liferay.deleteOptionsBatch(
        config,
        baseOpts,
        callbackUrl
      );
      if (optionsRes?.batchRefs) {
        this.recordBatches(
          optionsRes.batchRefs,
          config,
          'options',
          this._deriveTotalFromResult(optionsRes)
        );
      }
      await this._waitForBatches(optionsRes?.batchRefs, config, 'options');
    } else {
      logger.info('Skipping option deletion: No options found.', {
        operation: 'runDeleteAndMonitor',
      });
    }

    try {
      this.ctx.logger.info('Preparing option category deletion');

      try {
        const res = await this._listOptionCategories(config, { pageSize: 200 });
        const count = Array.isArray(res?.items) ? res.items.length : 0;
        this.ctx.logger.info('Pre-delete: total option categories', { count });
      } catch (e) {
        this.ctx.logger.debug('Pre-delete list failed for option categories', {
          error: e.message,
        });
      }

      await new Promise((r) => setTimeout(r, 1500));

      this.ctx.logger.info('Submitting batch delete for option categories');
      const optionCategories = await liferay.deleteOptionCategoriesBatch(
        config,
        { ...baseOpts, all: true },
        callbackUrl
      );
      if (optionCategories?.batchRefs)
        this.recordBatches(
          optionCategories.batchRefs,
          config,
          'optionCategories',
          this._deriveTotalFromResult(optionCategories)
        );
      await this._waitForBatches(
        optionCategories?.batchRefs,
        config,
        'optionCategories'
      );

      try {
        const res = await this._listOptionCategories(config, { pageSize: 200 });
        const count = Array.isArray(res?.items) ? res.items.length : 0;
        this.ctx.logger.info('Post-delete: total option categories', { count });
      } catch (e) {
        this.ctx.logger.debug('Post-delete list failed for option categories', {
          error: e.message,
        });
      }
    } catch (e) {
      this.ctx.logger.error('Option category delete stage failed', {
        error: e.message,
      });
    }

    return {
      orders,
      accounts,
      products,
      specifications,
      options: optionsRes,
    };
  }

  async runDeleteSelectedAndMonitor(
    config,
    options = {},
    { channelId, catalogId }
  ) {
    const { liferay, logger } = this.ctx;

    const baseOpts = {
      ...options,
      importStrategy: options.importStrategy || 'ON_ERROR_CONTINUE',
    };
    const callbackUrl =
      config.microserviceUrl && config.microserviceUrl !== 'null'
        ? `${config.microserviceUrl}/api/batch/callback`
        : null;

    let orders, accounts, products, optionsRes;

    const existingOrders = await liferay.getCommerceOrders(config, {
      channelId,
      pageSize: 1,
    });

    if (existingOrders?.items?.length > 0) {
      orders = await liferay.deleteCommerceOrders(
        config,
        { ...baseOpts, channelId },
        callbackUrl
      );
      if (orders?.batchRefs) {
        this.recordBatches(
          orders.batchRefs,
          config,
          'orders',
          this._deriveTotalFromResult(orders)
        );
      }
      await this._waitForBatches(orders?.batchRefs, config, 'orders');
    } else {
      logger.info('Skipping order deletion: No orders found for channel.', {
        operation: 'runDeleteSelectedAndMonitor',
        channelId,
      });
    }

    const existingAccounts = await liferay.getCommerceAccounts(config, {
      channelId,
      pageSize: 1,
    });

    if (existingAccounts?.items?.length > 0) {
      accounts = await liferay.deleteCommerceAccounts(
        config,
        { ...baseOpts, channelId },
        callbackUrl
      );
      if (accounts?.batchRefs) {
        this.recordBatches(
          accounts.batchRefs,
          config,
          'accounts',
          this._deriveTotalFromResult(accounts)
        );
      }
      await this._waitForBatches(accounts?.batchRefs, config, 'accounts');
    } else {
      logger.info('Skipping account deletion: No accounts found for channel.', {
        operation: 'runDeleteSelectedAndMonitor',
        channelId,
      });
    }

    const existingProducts = await liferay.getCommerceProducts(config, {
      catalogId,
      pageSize: 1,
    });

    if (existingProducts?.items?.length > 0) {
      products = await liferay.deleteCommerceProducts(
        config,
        { ...baseOpts, catalogId },
        callbackUrl
      );
      if (products?.batchRefs) {
        this.recordBatches(
          products.batchRefs,
          config,
          'products',
          this._deriveTotalFromResult(products)
        );
      }
      await this._waitForBatches(products?.batchRefs, config, 'products');
    } else {
      logger.info('Skipping product deletion: No products found for catalog.', {
        operation: 'runDeleteSelectedAndMonitor',
        catalogId,
      });
    }

    const existingOptions = await liferay.getOptions(config, { pageSize: 1 });

    if (existingOptions?.items?.length > 0) {
      optionsRes = await liferay.deleteOptionsBatch(
        config,
        baseOpts,
        callbackUrl
      );
      if (optionsRes?.batchRefs) {
        this.recordBatches(
          optionsRes.batchRefs,
          config,
          'options',
          this._deriveTotalFromResult(optionsRes)
        );
      }
      await this._waitForBatches(optionsRes?.batchRefs, config, 'options');
    } else {
      logger.info('Skipping option deletion: No options found.', {
        operation: 'runDeleteSelectedAndMonitor',
        channelId,
        catalogId,
      });
    }

    return {
      orders,
      accounts,
      products,
      options: optionsRes,
    };
  }
}

module.exports = DeleteCoordinatorService;
