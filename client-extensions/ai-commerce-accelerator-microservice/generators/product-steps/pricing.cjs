const {
  delay,
  createERC,
  buildStableERC,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');

const S = WORKFLOW_STEPS;

async function runGeneratePriceListsStep(sessionId) {
  try {
    return await _runPricingStep.call(
      this,
      sessionId,
      S.GENERATE_PRICE_LISTS,
      (e) => !e.bulkPricing && (!e.tierPrices || e.tierPrices.length === 0)
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error(`Error in generate-price-lists step: ${error.message}`, {
      sessionId,
      errorReferenceCode,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.GENERATE_PRICE_LISTS,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runGenerateBulkPricingStep(sessionId) {
  try {
    return await _runPricingStep.call(
      this,
      sessionId,
      S.GENERATE_BULK_PRICING,
      (e) => e.bulkPricing === true
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error(`Error in generate-bulk-pricing step: ${error.message}`, {
      sessionId,
      errorReferenceCode,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.GENERATE_BULK_PRICING,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runGenerateTierPricingStep(sessionId) {
  try {
    return await _runPricingStep.call(
      this,
      sessionId,
      S.GENERATE_TIER_PRICING,
      (e) => !e.bulkPricing && e.tierPrices && e.tierPrices.length > 0
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error(`Error in generate-tier-pricing step: ${error.message}`, {
      sessionId,
      errorReferenceCode,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.GENERATE_TIER_PRICING,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runUpdateCatalogConfigurationStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config } = session.context;
  const catalogId = parseInt(config.catalogId, 10);

  this.logger.info('Starting update catalog configuration step', {
    sessionId,
    correlationId: session.correlationId,
  });

  try {
    const PRICE_LIST_CONFIGS = [
      {
        erc: buildStableERC(ERC_PREFIX.PRICE_LIST, [
          'GENERAL',
          catalogId,
          sessionId,
        ]),
        label: 'Standard Price List',
        type: 'price-list',
      },
      {
        erc: buildStableERC(ERC_PREFIX.PRICE_LIST, [
          'PROMOTIONS',
          catalogId,
          sessionId,
        ]),
        label: 'Promotions List',
        type: 'promotion',
      },
    ];

    const aicaLists = [];
    for (const item of PRICE_LIST_CONFIGS) {
      const pl = await this.liferay.getPriceListByERC(config, item.erc);
      if (pl) {
        aicaLists.push({ ...item, id: pl.id });
      }
    }

    // HARDENING: Pricing V2.0 strictly forbids 'catalogId eq' filters in 2025.Q1.
    // We fetch all and filter in memory to bypass "Collection not allowed" errors.
    const res = await this.liferay.getPriceLists(config, {
      ignoreExclusions: true,
      pageSize: 1000,
    });

    const items = (res.items || []).filter(
      (it) => !catalogId || Number(it.catalogId) === Number(catalogId)
    );
    for (const pl of items) {
      const isTarget = aicaLists.some((aica) => aica.id === pl.id);
      if (pl.catalogBasePriceList && !isTarget) {
        await this.liferay.patchPriceList(config, pl.id, {
          catalogBasePriceList: false,
        });
        await delay(1000);
      }
    }

    let updateCount = 0;
    for (const pl of aicaLists) {
      await this.liferay.patchPriceList(config, pl.id, {
        catalogBasePriceList: true,
      });
      updateCount++;
      await delay(2000);
    }

    await this.completeSyncStep(
      sessionId,
      S.UPDATE_CATALOG_CONFIG,
      'SYNCHRONOUS',
      updateCount,
      PRICE_LIST_CONFIGS.length
    );
  } catch (err) {
    const errorReferenceCode =
      resolveErrorReference(err) || createERC(ERC_PREFIX.ERROR);
    this.logger.error(
      `Failed to update catalog configuration: ${err.message}`,
      {
        sessionId,
        errorReferenceCode,
      }
    );
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.UPDATE_CATALOG_CONFIG,
      status: 'FAILED',
    });
    throw err;
  }
}

async function _runPricingStep(sessionId, stepKey, filterFn) {
  const session = await this.persistence.getSession(sessionId);
  const { config, options, productDataList } = session.context;
  const catalogId = config.catalogId;

  if (!productDataList || productDataList.length === 0) {
    return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
  }

  this.logger.info(`Starting ${stepKey} step`, { sessionId });

  const ercToIdMap = await _ensurePriceLists.call(
    this,
    config,
    sessionId,
    session.correlationId,
    options
  );
  const generalListERC = buildStableERC(ERC_PREFIX.PRICE_LIST, [
    'GENERAL',
    catalogId,
    sessionId,
  ]);
  const promoListERC = buildStableERC(ERC_PREFIX.PRICE_LIST, [
    'PROMOTIONS',
    catalogId,
    sessionId,
  ]);

  const generalListId = ercToIdMap.get(generalListERC);
  const promotionsListId = ercToIdMap.get(promoListERC);

  if (!generalListId)
    throw new Error(`Failed to resolve target price list for ${stepKey}`);

  const priceListTemplates = [
    {
      id: generalListId,
      externalReferenceCode: generalListERC,
      name: `AICA - Standard Prices (${catalogId})`,
      type: 'price-list',
      catalogId: parseInt(config.catalogId, 10),
      currencyCode: config.currencyCode || 'USD',
      priceEntries: [],
    },
  ];

  if (promotionsListId) {
    priceListTemplates.push({
      id: promotionsListId,
      externalReferenceCode: promoListERC,
      name: `AICA - Promotions (${catalogId})`,
      type: 'promotion',
      catalogId: parseInt(config.catalogId, 10),
      currencyCode: config.currencyCode || 'USD',
      priceEntries: [],
    });
  }

  let totalEntries = 0;
  const seenPriceERCs = new Set();

  for (const product of productDataList) {
    if (!Array.isArray(product.priceEntries)) product.priceEntries = [];

    // Auto-generate missing price entries for variants based on the base price entry
    const baseEntry =
      product.priceEntries.find(
        (e) =>
          e.skuExternalReferenceCode === product.baseSku ||
          e.skuExternalReferenceCode === product.externalReferenceCode ||
          e.skuExternalReferenceCode === product.skus?.[0]?.sku
      ) || product.priceEntries[0]; // fallback to first entry

    if (baseEntry && Array.isArray(product.skuVariants)) {
      for (const variant of product.skuVariants) {
        const variantSku = variant.externalReferenceCode || variant.sku;
        const exists = product.priceEntries.some(
          (e) => e.skuExternalReferenceCode === variantSku
        );

        if (!exists) {
          // Synthesize price entry for variant
          const modifier =
            typeof variant.priceModifier === 'number'
              ? variant.priceModifier
              : 0;
          const newPrice = Number(
            (baseEntry.price * (1 + modifier)).toFixed(2)
          );
          const newPromo = baseEntry.promoPrice
            ? Number((baseEntry.promoPrice * (1 + modifier)).toFixed(2))
            : undefined;

          product.priceEntries.push({
            ...baseEntry,
            skuExternalReferenceCode: variantSku,
            price: newPrice > 0 ? newPrice : 0.01,
            promoPrice: newPromo,
            tierPrices: [],
          });
        }
      }
    }

    for (const entry of product.priceEntries) {
      if (!filterFn(entry)) continue;

      const skuERC =
        entry.skuExternalReferenceCode ||
        (typeof entry.sku === 'string' ? entry.sku : null);

      // HARDENING: Look for the resolved ID in BOTH the skus and skuVariants arrays
      const allSkus = [...(product.skus || []), ...(product.skuVariants || [])];
      const matchedSku = allSkus.find(
        (s) => s.externalReferenceCode === skuERC || s.sku === skuERC
      );
      const skuId = matchedSku?.id;

      // CRITICAL: If we still have a placeholder (like 50000) or no ID, do NOT send it.
      // Pricing V2.0 will crash the entire batch if one ID is invalid.
      if (!skuId || skuId === 50000) {
        this.logger.warn(
          `Skipping price entry for SKU ${skuERC}: Real physical ID not resolved yet.`,
          {
            sessionId,
            productId: product.id,
          }
        );
        continue;
      }

      const generalList = priceListTemplates[0];

      const peERC_general = buildStableERC('PE', [
        skuERC,
        generalList.externalReferenceCode || generalList.erc,
      ]);

      if (!seenPriceERCs.has(peERC_general)) {
        seenPriceERCs.add(peERC_general);
        // Deduplicate tier prices by minimumQuantity to prevent internal ERC collisions
        const uniqueTierPrices = [];
        const seenTierQuantities = new Set();
        for (const tp of entry.tierPrices || []) {
          if (!seenTierQuantities.has(tp.minimumQuantity)) {
            seenTierQuantities.add(tp.minimumQuantity);
            uniqueTierPrices.push(tp);
          }
        }

        const basePriceEntry = {
          price: entry.price,
          priceListId: generalList.id,
          externalReferenceCode: peERC_general,
          active: true,
          hasTierPrice: uniqueTierPrices.length > 0,
          skuId,
          skuExternalReferenceCode: skuERC,
        };

        if (uniqueTierPrices.length > 0) {
          basePriceEntry.tierPrices = uniqueTierPrices.map((tp) => ({
            minimumQuantity: tp.minimumQuantity,
            price: tp.price,
            externalReferenceCode: buildStableERC('TP', [
              skuERC,
              generalList.externalReferenceCode || generalList.erc,
              tp.minimumQuantity,
            ]),
          }));
        }

        // Liferay strict DTOs often reject unknown fields.
        // bulkPricing and discountDiscovery are not in the standard v2.0 PriceEntry DTO.
        // Removed them to prevent 400 Bad Request.

        generalList.priceEntries.push(basePriceEntry);
        totalEntries++;
      }

      if (promotionsListId && entry.promoPrice) {
        const promoList = priceListTemplates[1];
        const peERC_promo = buildStableERC('PE', [
          skuERC,
          promoList.externalReferenceCode || promoList.erc,
        ]);

        if (!seenPriceERCs.has(peERC_promo)) {
          seenPriceERCs.add(peERC_promo);
          const promoPriceEntry = {
            price: entry.promoPrice,
            priceListId: promoList.id,
            externalReferenceCode: peERC_promo,
            active: true,
            hasTierPrice: false,
            skuId,
            skuExternalReferenceCode: skuERC,
          };

          promoList.priceEntries.push(promoPriceEntry);
          totalEntries++;
        }
      }
    }
  }

  for (const pl of priceListTemplates) {
    const priceEntries = pl.priceEntries;
    if (!priceEntries || priceEntries.length === 0) continue;

    await this.submitBatch(
      sessionId,
      stepKey,
      'priceLists',
      'generate',
      async (_batchERC) => {
        this.logger.info(
          `Simulating batch creation of ${priceEntries.length} price entries for list ${pl.id} directly from ProductGenerator to bypass DXP platform bugs...`,
          { sessionId }
        );
        return await this.liferay.createPriceEntriesBatch(
          config,
          priceEntries,
          {
            sessionId,
            externalReferenceCode: pl.externalReferenceCode || pl.erc,
            priceListExternalReferenceCode: pl.externalReferenceCode || pl.erc,
          }
        );
      },
      priceEntries.length
    );
  }

  if (totalEntries === 0) {
    await this.completeSyncStep(sessionId, stepKey, 'SYNCHRONOUS');
  }
}

async function _ensurePriceLists(
  config,
  sessionId,
  correlationId,
  options = {}
) {
  const catalogId = config.catalogId;
  const generateNewLists = options.generatePriceLists;
  const ercToIdMap = new Map();

  const PRICE_LIST_TEMPLATES = [
    {
      erc: buildStableERC(ERC_PREFIX.PRICE_LIST, [
        'GENERAL',
        catalogId,
        sessionId,
      ]),
      name: `AICA - Standard Prices (${catalogId})`,
      priority: 1,
      type: 'price-list',
    },
    {
      erc: buildStableERC(ERC_PREFIX.PRICE_LIST, [
        'PROMOTIONS',
        catalogId,
        sessionId,
      ]),
      name: `AICA - Promotions (${catalogId})`,
      priority: 2,
      type: 'promotion',
    },
  ];

  if (generateNewLists) {
    try {
      const { items: existingLists } = await this.liferay.getPriceLists(
        config,
        { catalogId }
      );
      for (const pl of existingLists || []) {
        if (
          pl.name === `AICA - Standard Prices (${catalogId})` ||
          pl.name === `AICA - Promotions (${catalogId})`
        ) {
          try {
            await this.liferay.rest._delete(
              config,
              `/o/headless-commerce-admin-pricing/v2.0/price-lists/${pl.id}`
            );
            this.logger.info(
              `Deleted legacy/duplicate price list: ${pl.name} (${pl.id})`,
              { sessionId }
            );
          } catch (err) {
            this.logger.warn(
              `Failed to delete legacy price list ${pl.id}: ${err.message}`,
              { sessionId }
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to fetch existing price lists for cleanup: ${err.message}`,
        { sessionId }
      );
    }
  }

  for (const pl of PRICE_LIST_TEMPLATES) {
    let existing = await this.liferay.getPriceListByERC(config, pl.erc);
    if (!existing && generateNewLists) {
      existing = await this.liferay.createPriceList(config, {
        externalReferenceCode: pl.erc,
        name: pl.name,
        currencyCode: config.currencyCode || 'USD',
        active: true,
        priority: pl.priority,
        catalogId: config.catalogId,
        type: pl.type,
        catalogBasePriceList: false,
        neverExpire: true,
      });
    }
    if (existing?.id) ercToIdMap.set(pl.erc, existing.id);
  }
  return ercToIdMap;
}

module.exports = {
  runGeneratePriceListsStep,
  runGenerateBulkPricingStep,
  runGenerateTierPricingStep,
  runUpdateCatalogConfigurationStep,
};
