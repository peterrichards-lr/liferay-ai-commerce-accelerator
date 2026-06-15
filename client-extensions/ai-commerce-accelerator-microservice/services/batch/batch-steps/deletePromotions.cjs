module.exports = async function deletePromotions(
  { liferay, logger },
  { config, options, session, items, batchERC, sessionId }
) {
  // Find a non-AICA promotion to become the base list, if not already provided
  const catalogId = options.catalogId || session?.context?.catalogId;
  let masterId = options.masterPromotionListId;

  if (catalogId && !masterId) {
    try {
      const { items: allLists } = await liferay.getPromotions(config, {
        catalogId,
      });
      const nonAica = allLists.find(
        (pl) =>
          !pl.externalReferenceCode?.startsWith('AICA-') &&
          !pl.erc?.startsWith('AICA-')
      );
      if (nonAica) {
        masterId = nonAica.id;
      }
    } catch (e) {
      logger.warn(
        `Failed to resolve non-AICA master promotion list: ${e.message}`,
        { sessionId }
      );
    }
  }

  // Restore master promotion list if available in context (safety)
  if (masterId) {
    try {
      logger.info(`Ensuring master promotion list ${masterId} is base`, {
        sessionId,
      });
      await liferay.patchPriceList(config, masterId, {
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
    session,
  });
  return result;
};
