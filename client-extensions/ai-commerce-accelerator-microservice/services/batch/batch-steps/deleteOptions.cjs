module.exports = async function deleteOptions(
  { liferay },
  { config, options, session, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteOptionsBatch(config, {
    ids,
    items,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
    session,
  });
  return result;
};
