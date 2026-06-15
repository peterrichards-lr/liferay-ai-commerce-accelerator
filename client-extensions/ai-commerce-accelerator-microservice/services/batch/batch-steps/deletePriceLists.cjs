module.exports = async function deletePriceLists(
  { liferay, logger },
  { config, options, session, items, batchERC, sessionId }
) {
  // Find a non-AICA price list to become the base list, if not already provided
  const catalogId = options.catalogId || session?.context?.catalogId;
  let masterId = options.masterPriceListId;

  if (catalogId && !masterId) {
    try {
      const { items: allLists } = await liferay.getPriceLists(config, {
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
        `Failed to resolve non-AICA master price list: ${e.message}`,
        { sessionId }
      );
    }
  }

  // Restore master list
  if (masterId) {
    try {
      logger.info(`Ensuring master price list ${masterId} is base`, {
        sessionId,
      });
      await liferay.patchPriceList(config, masterId, {
        catalogBasePriceList: true,
      });
    } catch (err) {
      logger.debug(`Master price list restoration skipped: ${err.message}`, {
        sessionId,
      });
    }
  }

  const result = await liferay.deletePriceListsBatch(config, {
    ...options,
    items,
    callbackBatchERC: batchERC,
    sessionId,
    session,
  });
  return result;
};
