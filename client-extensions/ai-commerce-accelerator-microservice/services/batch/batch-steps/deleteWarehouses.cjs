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
    nativeBatch: false, // Warehouses API does not support batch DELETE
    basePath: PATH.WAREHOUSES,
    listUrl: PATH.WAREHOUSES,
    op: 'warehouses:batch-delete',
    friendly: 'Delete warehouses (simulated batch)',
  });
  return result;
};
