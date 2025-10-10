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

  recordBatches(batchRefs, config, entityType) {
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
          affectsProgress: false,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          correlationId: config.correlationId || null,
          createdAt: new Date().toISOString(),
          entityType,
          liferayUrl: config.liferayUrl,
          localeCode: config.localeCode,
          mode: 'delete',
        },
        60 * 60 * 1000
      );

      logger.info('Batch config stored', {
        operation: 'batch-config-store',
        batchId,
        entityType,
      });
    }
  }

  async runDeleteAndMonitor(config, options = {}) {
    const { liferay, cache } = this.ctx;
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
      this.recordBatches(orders.batchRefs, config, 'orders', cache);
      this.recordBatches(accounts.batchRefs, config, 'accounts', cache);
      this.recordBatches(products.batchRefs, config, 'products', cache);
    }

    return { orders, accounts, products };
  }
}

module.exports = DeleteCoordinatorService;
