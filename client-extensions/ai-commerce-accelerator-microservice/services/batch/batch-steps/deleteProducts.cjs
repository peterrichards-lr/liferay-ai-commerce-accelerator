const { asItems } = require('../../../utils/liferayUtils.cjs');
const { runWithConcurrencyLimit } = require('../../../utils/misc.cjs');
const { deletionTargetIdOf } = require('../../../utils/productIdentity.cjs');

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
      const definitionId = deletionTargetIdOf(product);
      if (!definitionId) return;

      try {
        const productOptions = await liferay.getProductOptions(
          config,
          definitionId
        );
        await Promise.all(
          productOptions.map((po) =>
            liferay.deleteProductOption(config, definitionId, po.id)
          )
        );

        const productSpecs = await liferay.getProductSpecifications(
          config,
          definitionId
        );
        await Promise.all(
          productSpecs.map((ps) =>
            liferay.deleteProductSpecification(config, definitionId, ps.id)
          )
        );
      } catch (err) {
        logger.warn(
          `Failed to clear associations for product with definition id ${definitionId}: ${err.message}`
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
