module.exports = async function deleteAccounts(
  { liferay },
  { config, options, ids, items, channelId, batchERC, sessionId }
) {
  const result = await liferay.deleteAccountsBatch(config, {
    ids,
    items,
    channelId,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
  });
  return result;
};
