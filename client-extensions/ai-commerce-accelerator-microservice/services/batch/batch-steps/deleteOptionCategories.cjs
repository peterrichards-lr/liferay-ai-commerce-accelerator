const { PATH } = require('../../../utils/liferayPaths.cjs');

module.exports = async function deleteOptionCategories(
  { liferay },
  { config, options, ids, items, batchERC, sessionId }
) {
  const result = await liferay.deleteByFilter(config, {
    entityName: 'optionCategory',
    ids,
    items,
    pageSize: 200,
    externalReferenceCode: batchERC,
    dryRun: options.dryRun,
    sessionId,
    nativeBatch: true,
    path: PATH.OPTION_CATEGORIES_BATCH,
    listUrl: PATH.OPTION_CATEGORIES,
    op: 'optionCategories:batch-delete',
    friendly: 'Delete option categories (batch)',
  });
  return result;
};
