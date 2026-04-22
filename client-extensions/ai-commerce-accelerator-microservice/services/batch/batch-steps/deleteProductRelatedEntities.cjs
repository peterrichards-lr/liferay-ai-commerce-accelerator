module.exports = async function deleteProductRelatedEntities(
  { liferay },
  { config, options, session, productIds, sessionId }
) {
  if (productIds && productIds.length > 0) {
    // 1. Fetch ProductSpecifications to get global specificationId and optionCategoryId
    const productSpecifications = await liferay.getSpecificationsByProductIds(
      config,
      productIds
    );

    const specificationIds = [
      ...new Set(
        productSpecifications.map((s) => s.specificationId).filter(Boolean)
      ),
    ];
    const optionCategoryIds = [
      ...new Set(
        productSpecifications.map((s) => s.optionCategoryId).filter(Boolean)
      ),
    ];

    // 2. Fetch ProductOptions to get global optionId
    const productOptions = await liferay.getOptionsByProductIds(
      config,
      productIds
    );

    const optionIds = [
      ...new Set(productOptions.map((o) => o.optionId).filter(Boolean)),
    ];

    // 3. Perform deletions
    if (specificationIds.length > 0) {
      await liferay.deleteSpecificationsBatch(config, {
        ids: specificationIds,
        dryRun: options.dryRun,
        sessionId, session,
      });
    }

    if (optionIds.length > 0) {
      await liferay.deleteOptionsBatch(config, {
        ids: optionIds,
        dryRun: options.dryRun,
        sessionId, session,
      });
    }

    if (optionCategoryIds.length > 0) {
      await liferay.deleteOptionCategoriesBatch(config, {
        ids: optionCategoryIds,
        dryRun: options.dryRun,
        sessionId, session,
      });
    }
  }
  return null; // This step doesn't produce a batch result
};
