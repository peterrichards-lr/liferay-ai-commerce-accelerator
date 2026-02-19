const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteWarehouses(
  { liferay },
  { config, options, ids, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'warehouse',
    ids,
    pageSize: 200,
    externalReferenceCode: batchERC,
    dryRun: options.dryRun,
    sessionId,
    nativeBatch: true,
    path: PATH.WAREHOUSES_BATCH,
    listUrl: PATH.WAREHOUSES,
    op: 'warehouses:batch-delete',
    friendly: 'Delete warehouses (batch)',
  });
  return result;
};
