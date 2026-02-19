module.exports = async function deletePriceLists(
  { liferay },
  { config, options, items, batchERC }
) {
  const result = await liferay.deletePriceListsBatch(
    config,
    { ...options, items, callbackBatchERC: batchERC }
  );
  return result;
};
