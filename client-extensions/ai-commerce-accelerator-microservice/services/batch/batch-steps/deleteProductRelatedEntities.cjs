const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteProductRelatedEntities(
  { liferay },
  { config, options, productIds, sessionId }
) {
  if (productIds && productIds.length > 0) {
    // 1. Fetch ProductSpecifications to get global specificationId and optionCategoryId
    const productSpecifications = await liferay.getSpecificationsByProductIds(
      config,
      productIds
    );
    
    const specificationIds = [
      ...new Set(productSpecifications.map((s) => s.specificationId).filter(Boolean))
    ];
    const optionCategoryIds = [
      ...new Set(productSpecifications.map((s) => s.optionCategoryId).filter(Boolean))
    ];

    // 2. Fetch ProductOptions to get global optionId
    const productOptions = await liferay.getOptionsByProductIds(
      config,
      productIds
    );
    
    const optionIds = [
      ...new Set(productOptions.map((o) => o.optionId).filter(Boolean))
    ];

    // 3. Perform deletions
    if (specificationIds.length > 0) {
      await liferay.deleteByFilter(config, {
        entityName: 'specification',
        ids: specificationIds,
        pageSize: 200,
        dryRun: options.dryRun,
        sessionId,
        nativeBatch: true,
        path: PATH.SPECIFICATIONS_BATCH,
        listUrl: PATH.SPECIFICATIONS,
        op: 'specifications:batch-delete',
        friendly: 'Delete specifications (batch)',
      });
    }
    
    if (optionIds.length > 0) {
      await liferay.deleteByFilter(config, {
        entityName: 'option',
        ids: optionIds,
        pageSize: 200,
        dryRun: options.dryRun,
        sessionId,
        nativeBatch: true,
        path: PATH.OPTIONS_BATCH,
        listUrl: PATH.OPTIONS,
        op: 'options:batch-delete',
        friendly: 'Delete options (batch)',
      });
    }
    
    if (optionCategoryIds.length > 0) {
      await liferay.deleteByFilter(config, {
        entityName: 'optionCategory',
        ids: optionCategoryIds,
        pageSize: 200,
        dryRun: options.dryRun,
        sessionId,
        nativeBatch: true,
        path: PATH.OPTION_CATEGORIES_BATCH,
        listUrl: PATH.OPTION_CATEGORIES,
        op: 'optionCategories:batch-delete',
        friendly: 'Delete option categories (batch)',
      });
    }
  }
  return null; // This step doesn't produce a batch result
};
