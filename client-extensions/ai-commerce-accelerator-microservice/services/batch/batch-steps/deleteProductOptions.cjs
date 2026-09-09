const { asItems } = require('../../../utils/liferayUtils.cjs');
const { deletionTargetIdOf } = require('../../../utils/productIdentity.cjs');

module.exports = async function deleteProductOptions(
  { liferay, logger, persistence },
  { config, _options, _session, _sessionId, batchERC, items }
) {
  logger.info('Starting explicit removal of product-option associations');

  const products =
    Array.isArray(items) && items.length > 0
      ? items
      : asItems(
          await liferay.getProducts(config, {
            pageSize: 200,
          })
        );

  if (products.length === 0) {
    logger.info('No products found to clear options from.');
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
    const definitionId = deletionTargetIdOf(product);
    if (!definitionId) continue;

    try {
      const productOptions = await liferay.getProductOptions(
        config,
        definitionId
      );

      if (productOptions && productOptions.length > 0) {
        logger.debug(
          `Clearing ${productOptions.length} options from product with definition id ${definitionId}`
        );

        for (const po of productOptions) {
          if (!po.id) {
            logger.debug(
              `Skipping product option association removal: missing ID for product with definition id ${definitionId}`
            );
            continue;
          }
          await liferay.deleteProductOption(config, definitionId, po.id);
          clearedCount++;
        }
      }
    } catch (err) {
      logger.warn(
        `Failed to clear options for product with definition id ${definitionId}: ${err.message}`
      );
    }
  }

  logger.info(
    `Successfully cleared ${clearedCount} product-option associations.`
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
