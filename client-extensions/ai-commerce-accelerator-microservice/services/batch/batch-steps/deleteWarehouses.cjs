module.exports = async function deleteWarehouses(
  { liferay },
  { config, options, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteWarehousesBatch(config, {
    ids,
    items,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
  });
  return result;
};
