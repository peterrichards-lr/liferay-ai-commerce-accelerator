module.exports = async function deletePromotions(
  { liferay, logger },
  { config, options, items, batchERC, sessionId }
) {
  // Restore master promotion list if available in context (safety)
  if (options.masterPromotionListId) {
    try {
      logger.info(
        `Ensuring master promotion list ${options.masterPromotionListId} is base`,
        { sessionId }
      );
      await liferay.patchPriceList(config, options.masterPromotionListId, {
        catalogBasePriceList: true,
      });
    } catch (err) {
      logger.debug(
        `Master promotion list restoration skipped: ${err.message}`,
        { sessionId }
      );
    }
  }

  const result = await liferay.deletePromotionsBatch(config, {
    ...options,
    items,
    callbackBatchERC: batchERC,
    sessionId,
  });
  return result;
};
