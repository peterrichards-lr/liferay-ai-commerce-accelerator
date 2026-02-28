module.exports = async function deletePriceLists(
  { liferay, logger },
  { config, options, items, batchERC, sessionId }
) {
  // Restore master list if available in context (safety)
  if (options.masterPriceListId) {
    try {
      logger.info(`Ensuring master price list ${options.masterPriceListId} is base`, { sessionId });
      await liferay.patchPriceList(config, options.masterPriceListId, { catalogBasePriceList: true });
    } catch (err) {
      logger.debug(`Master price list restoration skipped: ${err.message}`, { sessionId });
    }
  }

  const result = await liferay.deletePriceListsBatch(
    config,
    { ...options, items, callbackBatchERC: batchERC, sessionId }
  );
  return result;
};
