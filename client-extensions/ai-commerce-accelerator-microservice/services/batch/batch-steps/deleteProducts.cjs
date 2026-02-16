module.exports = async function deleteProducts(
  { liferay },
  { config, options, catalogId, batchERC, ids }
) {
  let result;
  if (catalogId) {
    const productConfig = { ...config, catalogId };
    result = await liferay.deleteCommerceProducts(
      productConfig,
      { ...options, catalogId, callbackBatchERC: batchERC }
    );
  } else {
    result = await liferay.deleteAllCommerceProducts(
      config,
      { ...options, callbackBatchERC: batchERC }
    );
  }
  return result;
};
