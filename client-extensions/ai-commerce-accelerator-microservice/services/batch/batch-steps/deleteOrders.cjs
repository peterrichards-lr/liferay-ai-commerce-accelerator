const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteOrders(
  { liferay },
  { config, options, ids, channelId, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'order',
    ids,
    filter: channelId ? `channelId eq ${channelId}` : undefined,
    pageSize: 200,
    externalReferenceCode: batchERC,
    dryRun: options.dryRun,
    sessionId,
    nativeBatch: true,
    path: PATH.ORDERS_BATCH,
    listUrl: PATH.ORDERS,
    op: 'orders:batch-delete',
    friendly: 'Delete orders (batch)',
  });
  return result;
};

