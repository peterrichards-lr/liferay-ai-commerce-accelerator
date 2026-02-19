const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteProducts(
  { liferay },
  { config, options, ids, items, catalogId, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'product',
    ids,
    items,
    filter: catalogId ? `catalogId eq ${catalogId}` : undefined,
    pageSize: 200,
    externalReferenceCode: batchERC,
    dryRun: options.dryRun,
    sessionId,
    nativeBatch: true,
    path: PATH.PRODUCTS_BATCH,
    listUrl: PATH.PRODUCTS,
    op: 'products:batch-delete',
    friendly: 'Delete products (batch)',
  });
  return result;
};
