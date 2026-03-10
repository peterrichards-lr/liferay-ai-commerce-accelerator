const { createERC } = require('../../../utils/misc.cjs');
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
    // 1. Fetch all price lists for the target catalog
    const res = await liferay.getPriceLists(config, {
      catalogId,
      pageSize: 1000,
      ignoreExclusions: true, // We need to see system/master lists
    });

    const allLists = res.items || [];

    // 2. Identify Master Price List and Master Promotion
    // Logic: type === 'price-list'/'promotion' AND catalogBasePriceList === true
    const masterPriceList = allLists.find(
      (pl) => pl.type === 'price-list' && pl.catalogBasePriceList === true
    );
    const masterPromotion = allLists.find(
      (pl) => pl.type === 'promotion' && pl.catalogBasePriceList === true
    );

    const masterPriceListId = masterPriceList?.id;
    const masterPromotionId = masterPromotion?.id;

    if (!masterPriceListId || !masterPromotionId) {
      logger.warn(
        `Dynamic master identification incomplete for catalog ${catalogId}. ` +
        `Found PriceList: ${masterPriceListId || 'MISSING'}, Promotion: ${masterPromotionId || 'MISSING'}. ` +
        `Proceeding with available defaults.`,
        { sessionId }
      );
    }

    // 3. Perform the Catalog Update via Admin API
    // Mirroring the portlet action identified in the HAR trace
    const catalogUpdatePayload = {};
    if (masterPriceListId) {
      catalogUpdatePayload.baseCommercePriceListId = masterPriceListId;
    }
    if (masterPromotionId) {
      catalogUpdatePayload.basePromotionCommercePriceListId = masterPromotionId;
    }

    if (Object.keys(catalogUpdatePayload).length > 0) {
      logger.info(`Updating catalog ${catalogId} to restore system master pricing...`, { 
        sessionId,
        masterPriceListId,
        masterPromotionId 
      });
      
      await liferay.patchCatalog(config, catalogId, catalogUpdatePayload);
      
      logger.info('Catalog reset to system defaults. AICA price lists are now unlocked for deletion.', {
        sessionId
      });
    }

    // 4. Record completion and proceed
    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'resetCatalogConfiguration',
      status: 'SYNCHRONOUS',
      processedCount: 1,
      totalCount: 1,
    });

    return { success: true };
  } catch (err) {
    logger.error(`Failed to reset catalog configuration: ${err.message}`, {
      sessionId,
      error: err,
    });
    
    // We create a failed batch record but don't throw, allowing the coordinator 
    // to decide whether to attempt commerce data deletion anyway.
    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'resetCatalogConfiguration',
      status: 'FAILED',
      processedCount: 0,
      totalCount: 1,
    });
    
    return { success: false };
  }
};
