module.exports = async function deleteProductRelatedEntities(
  { liferay },
  { config, options, productIds }
) {
  if (productIds && productIds.length > 0) {
    const specifications = await liferay.getSpecificationsByProductIds(
      config,
      productIds
    );
    const specificationIds = specifications.map((s) => s.id);
    const optionIds = specifications.map((s) => s.optionId).filter(Boolean);
    const optionCategoryIds = specifications
      .map((s) => s.optionCategoryId)
      .filter(Boolean);

    if (specificationIds.length > 0) {
      await liferay.deleteSpecificationsBatch(
        config,
        { ...options, ids: specificationIds }
      );
    }
    if (optionIds.length > 0) {
      await liferay.deleteOptionsBatch(
        config,
        { ...options, ids: optionIds }
      );
    }
    if (optionCategoryIds.length > 0) {
      await liferay.deleteOptionCategoriesBatch(
        config,
        { ...options, ids: optionCategoryIds }
      );
    }
  }
  return null; // This step doesn't produce a batch result
};
