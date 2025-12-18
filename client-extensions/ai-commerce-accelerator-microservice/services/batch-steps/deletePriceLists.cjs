module.exports = async function deletePriceLists(
  { liferay },
  { config, options, callbackUrl, batchERC }
) {
  const nextCallbackUrl = `${callbackUrl}&entity=priceLists`;
  const result = await liferay.deletePriceListsBatch(
    config,
    { ...options, callbackBatchERC: batchERC },
    nextCallbackUrl
  );
  return result;
};
