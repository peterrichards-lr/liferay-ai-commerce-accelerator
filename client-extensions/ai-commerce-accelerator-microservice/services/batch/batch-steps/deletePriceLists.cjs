module.exports = async function deletePriceLists(
  { liferay },
  { config, options, batchERC }
) {
  const result = await liferay.deletePriceListsBatch(
    config,
    { ...options, callbackBatchERC: batchERC }
  );
  return result;
};
