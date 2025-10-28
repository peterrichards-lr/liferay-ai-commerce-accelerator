class DeleteCoordinatorService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  _extractIdFromLocation(location) {
    if (!location) return null;
    const m = String(location).match(/\/import-task\/(\d+)\b/);
    return m ? m[1] : null;
  }

  _normalizeBatchId(ref) {
    return (
      ref?.taskId ||
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
    const { logger, cache } = this.ctx;
    if (!Array.isArray(batchRefs) || batchRefs.length === 0) return;

    for (const ref of batchRefs) {
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
        },
        60 * 60 * 1000
      );

      logger.info('Batch config stored', {
        operation: 'batch-config-store',
        batchId,
        entityType,
        totalCount: Number.isFinite(totalCount) ? totalCount : 0,
      });
    }
  }

  async runDeleteAndMonitor(config, options = {}) {
    const { liferay } = this.ctx;
    const callbackUrl =
      config.microserviceUrl && config.microserviceUrl !== 'null'
        ? `${config.microserviceUrl}/api/batch/callback`
        : null;

    const orders = await liferay.deleteCommerceOrders(config, {
      ...options,
      callbackUrl,
    });

    const accounts = await liferay.deleteCommerceAccounts(config, {
      ...options,
      callbackUrl,
    });

    const products = await liferay.deleteCommerceProducts(config, {
      ...options,
      callbackUrl,
    });

    if (!options.dryRun && callbackUrl) {
      const ordersTotal = this._deriveTotalFromResult(orders);
      const accountsTotal = this._deriveTotalFromResult(accounts);
      const productsTotal = this._deriveTotalFromResult(products);

      this.recordBatches(orders.batchRefs, config, 'orders', ordersTotal);
      this.recordBatches(accounts.batchRefs, config, 'accounts', accountsTotal);
      this.recordBatches(products.batchRefs, config, 'products', productsTotal);
    }

    return { orders, accounts, products };
  }
}

module.exports = DeleteCoordinatorService;
