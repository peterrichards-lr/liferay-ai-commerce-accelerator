const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteSpecifications(
  { liferay },
  { config, options, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'specification',
    ids,
    items,
    pageSize: 200,
    externalReferenceCode: batchERC,
    dryRun: options.dryRun,
    sessionId,
    nativeBatch: true,
    path: PATH.SPECIFICATIONS_BATCH,
    listUrl: PATH.SPECIFICATIONS,
    op: 'specifications:batch-delete',
    friendly: 'Delete specifications (batch)',
  });
  return result;
};
