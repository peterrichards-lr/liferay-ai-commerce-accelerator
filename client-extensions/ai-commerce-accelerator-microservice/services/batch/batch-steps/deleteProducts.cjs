const { asItems } = require('../../../utils/liferayUtils.cjs');
const { runWithConcurrencyLimit } = require('../../../utils/misc.cjs');

module.exports = async function deleteProducts(
  { liferay, logger, config: configService },
  { config, options, session, ids, items, catalogId, batchERC, sessionId }
) {
  // Discovery phase to clear associations if not already provided
  if (!items || items.length === 0) {
    const productsRes = await liferay.getProducts(config, {
      catalogId,
      pageSize: 200,
    });
    items = asItems(productsRes);
  }

  if (items && items.length > 0) {
    const resilienceConfig =
      configService?.getWorkflowResilienceConfigCached?.() || {};
    const concurrency = resilienceConfig.deletionConcurrency ?? 5;

    logger.info(
      `Clearing associations for ${items.length} products before deletion (concurrency: ${concurrency})`
    );

    await runWithConcurrencyLimit(items, concurrency, async (product) => {
      const productId = product.productId || product.id;
      if (!productId) return;

      try {
        const productOptions = await liferay.getProductOptions(
          config,
          productId
        );
        await Promise.all(
          productOptions.map((po) =>
            liferay.deleteProductOption(config, productId, po.id)
          )
        );

        const productSpecs = await liferay.getProductSpecifications(
          config,
          productId
        );
        await Promise.all(
          productSpecs.map((ps) =>
            liferay.deleteProductSpecification(config, productId, ps.id)
          )
        );
      } catch (err) {
        logger.warn(
          `Failed to clear associations for product ${productId}: ${err.message}`
        );
      }
    });
  }

  const result = await liferay.deleteProductsBatch(config, {
    ids,
    items,
    catalogId,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
    session,
  });
  return result;
};
