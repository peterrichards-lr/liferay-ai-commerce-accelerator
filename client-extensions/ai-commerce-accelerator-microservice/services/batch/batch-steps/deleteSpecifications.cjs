module.exports = async function deleteSpecifications(
  { liferay },
  { config, options, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteSpecificationsBatch(config, {
    ids,
    items,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
  });
  return result;
};
