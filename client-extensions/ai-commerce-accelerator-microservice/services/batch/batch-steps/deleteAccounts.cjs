module.exports = async function deleteAccounts(
  { liferay },
  { config, options, ids, items, channelId, batchERC, sessionId, filter }
) {
  // Use provided filter or fallback to accelerator prefix
  const finalFilter = filter || `externalReferenceCode sw 'AICA-ACC'`;

  const result = await liferay.deleteAccountsBatch(config, {
    ids,
    items,
    channelId,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
    filter: finalFilter,
  });
  return result;
};
