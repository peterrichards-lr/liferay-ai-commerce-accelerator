module.exports = async function deleteOrders(
  { liferay },
  { config, options, ids, items, channelId, batchERC, sessionId }
) {
  const result = await liferay.deleteOrdersBatch(config, {
    ids,
    items,
    filter: channelId ? `channelId eq ${channelId}` : undefined,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
  });
  return result;
};
