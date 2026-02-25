const { PATH } = require('../../../utils/liferayPaths.cjs');
const { asItems, asCount } = require('../../../utils/liferayUtils.cjs');

module.exports = async function deleteProductOptions(
  { liferay, logger, persistence },
  { config, options, sessionId, batchERC }
) {
  logger.info('Starting explicit removal of product-option associations');

  const productsRes = await liferay.getProducts(config, {
    pageSize: 200,
  });

  const products = asItems(productsRes);

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
    const productId = product.productId || product.id;
    if (!productId) continue;

    try {
      const productOptions = await liferay.getProductOptions(config, productId);
      
      if (productOptions && productOptions.length > 0) {
        logger.debug(`Clearing ${productOptions.length} options from product ${productId}`);
        
        for (const po of productOptions) {
          if (!po.id) {
            logger.debug(`Skipping product option association removal: missing ID for product ${productId}`);
            continue;
          }
          await liferay.deleteProductOption(config, productId, po.id);
          clearedCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to clear options for product ${productId}: ${err.message}`);
    }
  }

  logger.info(`Successfully cleared ${clearedCount} product-option associations.`);

  if (batchERC) {
    await persistence.updateBatch(batchERC, {
      status: 'COMPLETED',
      processedCount: clearedCount,
      totalCount: clearedCount,
    });
  }

  return { success: true, count: clearedCount };
};
