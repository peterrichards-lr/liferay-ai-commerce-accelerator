module.exports = async function deleteProducts(
  { liferay },
  { config, options, callbackUrl, catalogId, batchERC, ids }
) {
  const nextCallbackUrl = `${callbackUrl}&entity=products`;
  let result;
  if (catalogId) {
    const productConfig = { ...config, catalogId };
    result = await liferay.deleteCommerceProducts(
      productConfig,
      { ...options, catalogId, callbackBatchERC: batchERC },
      nextCallbackUrl
    );
  } else {
    result = await liferay.deleteAllCommerceProducts(
      config,
      { ...options, callbackBatchERC: batchERC },
      nextCallbackUrl
    );
  }
  return result;
};
