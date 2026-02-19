const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteOptions(
  { liferay },
  { config, options, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'option',
    ids,
    items,
    pageSize: 200,
    externalReferenceCode: batchERC,
    dryRun: options.dryRun,
    sessionId,
    nativeBatch: true,
    path: PATH.OPTIONS_BATCH,
    listUrl: PATH.OPTIONS,
    op: 'options:batch-delete',
    friendly: 'Delete options (batch)',
  });
  return result;
};
