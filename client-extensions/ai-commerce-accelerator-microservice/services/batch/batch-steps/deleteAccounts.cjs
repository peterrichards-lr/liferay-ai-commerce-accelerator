const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteAccounts(
  { liferay },
  { config, options, ids, items, channelId, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'account',
    ids,
    items,
    pageSize: 200,
    externalReferenceCode: batchERC,
    dryRun: options.dryRun,
    sessionId,
    nativeBatch: true,
    path: PATH.ACCOUNTS_BATCH,
    listUrl: PATH.ACCOUNTS,
    op: 'accounts:batch-delete',
    friendly: 'Delete accounts (batch)',
    channelId, 
  });
  return result;
};
