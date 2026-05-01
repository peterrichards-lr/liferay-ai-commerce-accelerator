const { asItems } = require('../../../utils/liferayUtils.cjs');

module.exports = async function deleteProducts(
  { liferay, logger },
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
    logger.info(
      `Clearing associations for ${items.length} products before deletion`
    );
    for (const product of items) {
      const productId = product.productId || product.id;
      if (!productId) continue;

      try {
        // Clear options
        const productOptions = await liferay.getProductOptions(
          config,
          productId
        );
        for (const po of productOptions) {
          await liferay.deleteProductOption(config, productId, po.id);
        }

        // Clear specifications
        const productSpecs = await liferay.getProductSpecifications(
          config,
          productId
        );
        for (const ps of productSpecs) {
          await liferay.deleteProductSpecification(config, productId, ps.id);
        }
      } catch (err) {
        logger.warn(
          `Failed to clear associations for product ${productId}: ${err.message}`
        );
      }
    }
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
