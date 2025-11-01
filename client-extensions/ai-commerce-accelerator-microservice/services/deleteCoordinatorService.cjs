const { getBatchCacheTTLms } = require('../utils/ttl.cjs');

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
        getBatchCacheTTLms(configService)
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

  async runDeleteAndMonitor(config, options = {}) {
    const { liferay } = this.ctx;

    const baseOpts = {
      ...options,
      importStrategy: options.importStrategy || 'ON_ERROR_CONTINUE',
    };
    const callbackUrl =
      config.microserviceUrl && config.microserviceUrl !== 'null'
        ? `${config.microserviceUrl}/api/batch/callback`
        : null;

    const orders = await liferay.deleteCommerceOrders(
      config,
      baseOpts,
      callbackUrl
    );
    if (orders?.batchRefs)
      this.recordBatches(
        orders.batchRefs,
        config,
        'orders',
        this._deriveTotalFromResult(orders)
      );
    await this._waitForBatches(orders?.batchRefs, config, 'orders');

    const accounts = await liferay
      .deleteCommerceAccounts(config, baseOpts, callbackUrl)
      .catch(() => null);
    if (accounts?.batchRefs)
      this.recordBatches(
        accounts.batchRefs,
        config,
        'accounts',
        this._deriveTotalFromResult(accounts)
      );
    await this._waitForBatches(accounts?.batchRefs, config, 'accounts');

    const products = await liferay.deleteCommerceProducts(
      config,
      baseOpts,
      callbackUrl
    );
    if (products?.batchRefs)
      this.recordBatches(
        products.batchRefs,
        config,
        'products',
        this._deriveTotalFromResult(products)
      );
    await this._waitForBatches(products?.batchRefs, config, 'products');

    const specifications = await liferay.deleteSpecificationsBatch(
      config,
      baseOpts,
      callbackUrl
    );
    if (specifications?.batchRefs)
      this.recordBatches(
        specifications.batchRefs,
        config,
        'specifications',
        this._deriveTotalFromResult(specifications)
      );
    await this._waitForBatches(
      specifications?.batchRefs,
      config,
      'specifications'
    );

    const optionsRes = await liferay.deleteOptionsBatch(
      config,
      baseOpts,
      callbackUrl
    );
    if (optionsRes?.batchRefs)
      this.recordBatches(
        optionsRes.batchRefs,
        config,
        'options',
        this._deriveTotalFromResult(optionsRes)
      );
    await this._waitForBatches(optionsRes?.batchRefs, config, 'options');

    const optionCategories = await liferay.deleteOptionCategoriesBatch(
      config,
      baseOpts,
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

    return {
      orders,
      accounts,
      products,
      specifications,
      options: optionsRes,
      optionCategories,
    };
  }
}

module.exports = DeleteCoordinatorService;
