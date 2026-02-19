const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deletePromotions(
  { liferay },
  { config, options, items, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'promotion',
    items,
    pageSize: 200,
    externalReferenceCode: batchERC,
    dryRun: options.dryRun,
    sessionId,
    nativeBatch: true,
    path: PATH.PRICE_LISTS_BATCH,
    listUrl: PATH.PRICE_LISTS,
    op: 'promotions:batch-delete',
    friendly: 'Delete promotions (batch)',
  });
  return result;
};
