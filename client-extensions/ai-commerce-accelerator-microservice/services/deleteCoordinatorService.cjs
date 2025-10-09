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

function recordBatches(batchRefs, config, entityType, cacheService) {
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

async function runDeleteAndMonitor(
  cacheService,
  liferayService,
  config,
  options = {}
) {
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
    recordBatches(orders.batchRefs, config, 'orders', cacheService);
    recordBatches(accounts.batchRefs, config, 'accounts', cacheService);
    recordBatches(products.batchRefs, config, 'products', cacheService);
  }

  return { orders, accounts, products };
}

module.exports = { runDeleteAndMonitor };
