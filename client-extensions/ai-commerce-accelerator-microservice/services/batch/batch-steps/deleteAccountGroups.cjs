module.exports = async function deleteAccountGroups(
  { liferay },
  { config, options, session, ids, items, batchERC, sessionId, filter, search }
) {
  // Use provided search/filter or fallback to accelerator prefix
  const finalSearch = search || (!filter ? 'SEG-' : undefined);

  const result = await liferay.deleteAccountGroupsBatch(config, {
    ids,
    items,
    callbackBatchERC: batchERC,
    dryRun: options.dryRun,
    sessionId,
    filter,
    search: finalSearch,
    session,
  });
  return result;
};
