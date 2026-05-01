const { asItems } = require('../../../utils/liferayUtils.cjs');

module.exports = async function deleteProductSpecifications(
  { liferay, logger, persistence },
  { config, _options, _session, _sessionId, batchERC, items }
) {
  logger.info(
    'Starting explicit removal of product-specification associations'
  );

  const products =
    Array.isArray(items) && items.length > 0
      ? items
      : asItems(
          await liferay.getProducts(config, {
            pageSize: 200,
          })
        );

  if (products.length === 0) {
    logger.info('No products found to clear specifications from.');
    if (batchERC) {
      await persistence.updateBatch(batchERC, {
        status: 'COMPLETED',
        processedCount: 0,
        totalCount: 0,
      });
    }
    return { success: true, count: 0 };
  }

  let clearedCount = 0;

  for (const product of products) {
    const productId = product.productId || product.id;
    if (!productId) continue;

    try {
      const productSpecifications = await liferay.getProductSpecifications(
        config,
        productId
      );

      if (productSpecifications && productSpecifications.length > 0) {
        logger.debug(
          `Clearing ${productSpecifications.length} specifications from product ${productId}`
        );

        for (const ps of productSpecifications) {
          if (!ps.id) {
            logger.debug(
              `Skipping product specification association removal: missing ID for product ${productId}`
            );
            continue;
          }
          await liferay.deleteProductSpecification(config, productId, ps.id);
          clearedCount++;
        }
      }
    } catch (err) {
      logger.warn(
        `Failed to clear specifications for product ${productId}: ${err.message}`
      );
    }
  }

  logger.info(
    `Successfully cleared ${clearedCount} product-specification associations.`
  );

  if (batchERC) {
    await persistence.updateBatch(batchERC, {
      status: 'COMPLETED',
      processedCount: clearedCount,
      totalCount: clearedCount,
    });
  }

  return { success: true, count: clearedCount };
};
