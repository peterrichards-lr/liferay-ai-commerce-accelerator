const { asItems } = require('../../../utils/liferayUtils.cjs');

module.exports = async function deleteProductSpecifications(
  { liferay, logger },
  { config, options, sessionId }
) {
  logger.info('Starting explicit removal of product-specification associations');

  const productsRes = await liferay.getCommerceProducts(config, {
    pageSize: 200,
  });

  const products = asItems(productsRes);

  if (products.length === 0) {
    logger.info('No products found to clear specifications from.');
    return { success: true, count: 0 };
  }

  let clearedCount = 0;

  for (const product of products) {
    const productId = product.productId || product.id;
    if (!productId) continue;

    try {
      const productSpecifications = await liferay.getCommerceProductSpecifications(config, productId);
      
      if (productSpecifications && productSpecifications.length > 0) {
        logger.debug(`Clearing ${productSpecifications.length} specifications from product ${productId}`);
        
        for (const ps of productSpecifications) {
          await liferay.deleteProductSpecification(config, productId, ps.id);
          clearedCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to clear specifications for product ${productId}: ${err.message}`);
    }
  }

  logger.info(`Successfully cleared ${clearedCount} product-specification associations.`);
  return { success: true, count: clearedCount };
};
