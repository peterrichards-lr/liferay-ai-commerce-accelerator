module.exports = async function deleteOptionCategories(
  { liferay },
  { config, options, callbackUrl, batchERC }
) {
  const nextCallbackUrl = `${callbackUrl}&entity=optionCategories`;
  const result = await liferay.deleteOptionCategoriesBatch(
    config,
    { ...options, callbackBatchERC: batchERC },
    nextCallbackUrl
  );
  return result;
};
