module.exports = async function deleteSpecifications(
  { liferay },
  { config, options, session, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteSpecificationsBatch(config, {
    ids,
    items,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
    session,
  });
  return result;
};
