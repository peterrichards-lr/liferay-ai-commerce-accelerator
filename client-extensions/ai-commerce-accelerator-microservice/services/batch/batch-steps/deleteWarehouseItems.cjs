module.exports = async function deleteWarehouseItems(
  { liferay },
  { config, options, session, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteWarehouseItemsBatch(config, {
    ids,
    items,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId, session,
  });
  return result;
};
