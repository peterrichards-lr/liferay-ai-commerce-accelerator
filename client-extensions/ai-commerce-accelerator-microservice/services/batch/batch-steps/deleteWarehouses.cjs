const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteWarehouses(
  { liferay },
  { config, options, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'warehouse',
    ids,
    items,
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
