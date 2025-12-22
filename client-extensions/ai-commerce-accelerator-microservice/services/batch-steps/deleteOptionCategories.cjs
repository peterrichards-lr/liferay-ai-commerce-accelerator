module.exports = async function deleteOptionCategories(
  { liferay },
  { config, options, batchERC }
) {
  const result = await liferay.deleteOptionCategoriesBatch(
    config,
    { ...options, callbackBatchERC: batchERC }
  );
  return result;
};
