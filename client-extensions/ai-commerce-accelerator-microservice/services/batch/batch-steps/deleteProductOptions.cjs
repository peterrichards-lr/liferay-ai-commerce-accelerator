const { PATH } = require('../../../utils/liferayPaths.cjs');
const { asItems, asCount } = require('../../../utils/liferayUtils.cjs');

module.exports = async function deleteProductOptions(
  { liferay, logger },
  { config, options, sessionId }
) {
  logger.info('Starting explicit removal of product-option associations');

  const productsRes = await liferay.getCommerceProducts(config, {
    pageSize: 200,
  });

  const products = asItems(productsRes);

  if (products.length === 0) {
    logger.info('No products found to clear options from.');
    return { success: true, count: 0 };
  }

  let clearedCount = 0;

  for (const product of products) {
    const productId = product.productId || product.id;
    if (!productId) continue;

    try {
      const productOptions = await liferay.getCommerceProductOptions(config, productId);
      
      if (productOptions && productOptions.length > 0) {
        logger.debug(`Clearing ${productOptions.length} options from product ${productId}`);
        
        for (const po of productOptions) {
          await liferay.deleteProductOption(config, productId, po.id);
          clearedCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to clear options for product ${productId}: ${err.message}`);
    }
  }

  logger.info(`Successfully cleared ${clearedCount} product-option associations.`);
  return { success: true, count: clearedCount };
};
