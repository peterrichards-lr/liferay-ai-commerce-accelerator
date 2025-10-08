const { cacheService } = require('./cacheService.cjs');
const { logger } = require('../utils/logger.cjs');

function extractIdFromLocation(location) {
  if (!location) return null;
  const m = String(location).match(/\/import-task\/(\d+)\b/);
  return m ? m[1] : null;
}

function normalizeBatchId(ref) {
  return (
    ref?.taskId || extractIdFromLocation(ref?.location) || ref?.batchId || null
  );
}

function recordBatches(batchRefs, config, entityType) {
  if (!Array.isArray(batchRefs) || batchRefs.length === 0) return;

  for (const ref of batchRefs) {
    const batchId = normalizeBatchId(ref);
    if (!batchId) {
      logger.warn('Unable to determine batchId from reference', {
        operation: 'batch-config-store-missing-id',
        entityType,
        ref,
      });
      continue;
    }

    cacheService.set(
      `batch:${batchId}:config`,
      {
        liferayUrl: config.liferayUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        localeCode: config.localeCode,
        entityType,
        mode: 'delete',
        affectsProgress: false,
        correlationId: config.correlationId || null,
        createdAt: new Date().toISOString(),
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

async function runDeleteAndMonitor(liferayService, config, options = {}) {
  const callbackUrl =
    config.microserviceUrl && config.microserviceUrl !== 'null'
      ? `${config.microserviceUrl}/api/batch/callback`
      : null;

  const orders = await liferayService.deleteCommerceOrders(config, {
    ...options,
    callbackUrl,
  });

  const accounts = await liferayService.deleteCommerceAccounts(config, {
    ...options,
    callbackUrl,
  });

  const products = await liferayService.deleteCommerceProducts(config, {
    ...options,
    callbackUrl,
  });

  if (!options.dryRun && callbackUrl) {
    recordBatches(orders.batchRefs, config, 'orders');
    recordBatches(accounts.batchRefs, config, 'accounts');
    recordBatches(products.batchRefs, config, 'products');
  }

  return { orders, accounts, products };
}

module.exports = { runDeleteAndMonitor };
