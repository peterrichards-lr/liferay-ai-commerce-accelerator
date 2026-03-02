const { createERC, delay } = require('../../../utils/misc.cjs');
const { ERC_PREFIX } = require('../../../utils/constants.cjs');

module.exports = async function resetCatalogConfiguration(
  { liferay, logger, persistence },
  { config, options, sessionId }
) {
  const catalogId = parseInt(config.catalogId, 10);
  logger.info(`Resetting catalog configuration for catalog ${catalogId}`, {
    sessionId,
  });

  try {
    // 1. Discover master lists to restore
    let masterPriceListId = options.masterPriceListId;
    let masterPromotionListId = options.masterPromotionListId;

    if (!masterPriceListId || !masterPromotionListId) {
      logger.debug('Searching for master price list fallbacks...', {
        sessionId,
      });

      const res = await liferay.getPriceLists(config, {
        filter: `catalogId eq ${catalogId}`,
        type: null, // Get all types
        ignoreExclusions: true,
        pageSize: 1000,
      });

      const allLists = res.items || [];

      // Find standard master list
      if (!masterPriceListId) {
        let fallback = allLists.find(
          (pl) =>
            String(pl.type || '')
              .toLowerCase()
              .includes('price') &&
            !pl.externalReferenceCode?.startsWith('AICA-') &&
            (pl.catalogBasePriceList ||
              pl.name?.toLowerCase().includes('master'))
        );
        
        // If no master found, just pick the first non-AICA price list
        if (!fallback) {
           fallback = allLists.find(
            (pl) =>
              String(pl.type || '')
                .toLowerCase()
                .includes('price') &&
              !pl.externalReferenceCode?.startsWith('AICA-')
          );
        }

        if (fallback) {
          masterPriceListId = fallback.id;
          logger.info(
            `Found master price list fallback: ${fallback.name} (${masterPriceListId})`,
            { sessionId }
          );
        }
      }

      // Find promotion master list
      if (!masterPromotionListId) {
        let fallback = allLists.find(
          (pl) =>
            String(pl.type || '')
              .toLowerCase()
              .includes('promotion') &&
            !pl.externalReferenceCode?.startsWith('AICA-') &&
            (pl.catalogBasePriceList ||
              pl.name?.toLowerCase().includes('master') ||
              pl.name?.toLowerCase().includes('default'))
        );

        // If no master/default found, pick the first non-AICA promotion list
        if (!fallback) {
          fallback = allLists.find(
            (pl) =>
              String(pl.type || '')
                .toLowerCase()
                .includes('promotion') &&
              !pl.externalReferenceCode?.startsWith('AICA-')
          );
        }

        if (fallback) {
          masterPromotionListId = fallback.id;
          logger.info(
            `Found master promotion list fallback: ${fallback.name} (${masterPromotionListId})`,
            { sessionId }
          );
        }
      }
    }

    // 2. Restore master lists
    let restoreCount = 0;
    if (masterPriceListId) {
      logger.info(
        `Restoring master price list ${masterPriceListId} as base for catalog ${catalogId}`,
        { sessionId }
      );
      await liferay.patchPriceList(config, masterPriceListId, {
        catalogBasePriceList: true,
      });
      restoreCount++;
      await delay(1000);
    } else {
      logger.warn(
        `Could not find a master price list to restore for catalog ${catalogId}`,
        { sessionId }
      );
    }

    if (masterPromotionListId) {
      logger.info(
        `Restoring master promotion list ${masterPromotionListId} as base for catalog ${catalogId}`,
        { sessionId }
      );
      await liferay.patchPriceList(config, masterPromotionListId, {
        catalogBasePriceList: true,
      });
      restoreCount++;
      await delay(1000);
    } else {
      logger.warn(
        `Could not find a master promotion list to restore for catalog ${catalogId}`,
        { sessionId }
      );
    }

    // 3. Explicitly unset AICA lists as base if they are still set
    const res = await liferay.getPriceLists(config, {
      pageSize: 100,
      search: 'AICA-',
      type: null, // Check all types
      ignoreExclusions: true,
    });

    for (const pl of res.items || []) {
      if (pl.catalogBasePriceList) {
        logger.info(
          `Unsetting AICA ${pl.type} '${pl.name}' (${pl.id}) as base`,
          { sessionId }
        );
        await liferay.patchPriceList(config, pl.id, {
          catalogBasePriceList: false,
        });
        await delay(1000);
      }
    }

    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'resetCatalogConfiguration',
      status: 'SYNCHRONOUS',
      processedCount: restoreCount,
      totalCount: 2,
    });

    return { success: true };
  } catch (err) {
    logger.error(`Failed to reset catalog configuration: ${err.message}`, {
      sessionId,
      error: err,
    });
    // Don't fail the whole workflow, try to proceed
    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'resetCatalogConfiguration',
      status: 'SYNCHRONOUS',
      processedCount: 0,
      totalCount: 2,
    });
    return { success: false };
  }
};
