module.exports = async function deleteAccounts(
  { liferay },
  {
    config,
    options,
    ids,
    items,
    channelId,
    batchERC,
    sessionId,
    filter,
    search,
  }
) {
  // Use provided search/filter or fallback to accelerator prefix
  const finalSearch = search || (!filter ? 'AICA-ACC' : undefined);

  const result = await liferay.deleteAccountsBatch(config, {
    ids,
    items,
    channelId,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
    filter,
    search: finalSearch,
  });
  return result;
};
