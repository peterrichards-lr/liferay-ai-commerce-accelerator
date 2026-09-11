const {
  delay,
  createERC,
  buildStableERC,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const { coverPriceEntries } = require('../../utils/priceEntryCoverage.cjs');
const {
  summariseFailures,
  writeEachEntity,
} = require('../../utils/entityWrites.cjs');

const S = WORKFLOW_STEPS;

const AICA_ERC_PREFIX = 'AICA-';

/**
 * Liferay creates one base price list and one base promotion per catalog
 * (CommerceBasePriceListHelper.addCatalogBaseCommercePriceList) and resolves
 * "the catalog's base list" by the catalogBasePriceList flag plus the type
 * (CommercePriceListLocalServiceImpl.fetchCatalogBaseCommercePriceListByType
 * -> fetchByG_C_T(groupId, true, type)), never by name. Posting a Sku with a
 * price writes a price entry into whichever list currently carries that flag -
 * SkuUtil.updateCommercePriceEntries, called unconditionally from
 * ProductResourceImpl and SkuResourceImpl - so a list AICA creates alongside
 * Liferay's is a second home for the same prices, and neither ends up holding
 * the whole picture. There is one list per purpose; AICA adopts it.
 */
const PRICE_LIST_PURPOSES = [
  { key: 'GENERAL', label: 'Standard Prices', priority: 1, type: 'price-list' },
  { key: 'PROMOTIONS', label: 'Promotions', priority: 2, type: 'promotion' },
];

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
    const { targets, catalogLists } = await _resolvePriceListTargets.call(
      this,
      config,
      sessionId,
      { create: false }
    );

    const resolved = targets.filter((target) => target.id);
    const targetIds = new Set(resolved.map((target) => String(target.id)));

    for (const pl of catalogLists) {
      if (pl.catalogBasePriceList && !targetIds.has(String(pl.id))) {
        await this.liferay.patchPriceList(config, pl.id, {
          catalogBasePriceList: false,
        });
        await delay(1000);
      }
    }

    let updateCount = 0;
    for (const target of resolved) {
      updateCount++;

      // An adopted list already carries the flag, so re-asserting it would only
      // spend a request and 2s of the step's budget on a value that cannot change.
      if (target.catalogBasePriceList) {
        this.logger.debug(
          `Price list ${target.id} (${target.name}) is already the catalog base ${target.type} for catalog ${catalogId}`,
          { sessionId }
        );
        continue;
      }

      await this.liferay.patchPriceList(config, target.id, {
        catalogBasePriceList: true,
      });
      await delay(2000);
    }

    await this.completeSyncStep(
      sessionId,
      S.UPDATE_CATALOG_CONFIG,
      'SYNCHRONOUS',
      updateCount,
      PRICE_LIST_PURPOSES.length
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
  const { config, options = {}, productDataList } = session.context;

  if (!productDataList || productDataList.length === 0) {
    return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
  }

  this.logger.info(`Starting ${stepKey} step`, { sessionId });

  const { targets } = await _resolvePriceListTargets.call(
    this,
    config,
    sessionId,
    { create: options.generatePriceLists }
  );

  const priceListTemplates = targets
    .filter((target) => target.id)
    .map((target) => ({ ...target, priceEntries: [] }));

  const generalList = priceListTemplates.find((pl) => pl.key === 'GENERAL');
  const promotionsList = priceListTemplates.find(
    (pl) => pl.key === 'PROMOTIONS'
  );

  if (!generalList)
    throw new Error(`Failed to resolve target price list for ${stepKey}`);

  const existingEntriesByList = new Map();
  for (const pl of priceListTemplates) {
    existingEntriesByList.set(
      pl.key,
      await _indexPriceEntriesBySku.call(this, config, pl, sessionId)
    );
  }

  let totalEntries = 0;
  const seenPriceERCs = new Set();
  const coverage = { dropped: 0, products: 0, synthesised: 0 };

  for (const product of productDataList) {
    // Enforced here rather than trusted to the prompt: an entry naming a SKU
    // Liferay will not create has no id to send, and Pricing v2.0 fails the
    // whole batch on one bad id. See #787.
    const covered = coverPriceEntries(product, {
      tiers: Boolean(
        options.generateBulkPricing || options.generateTierPricing
      ),
      variants: options.generateSkuVariants !== false,
    });

    product.priceEntries = covered.priceEntries;

    if (covered.dropped.length > 0 || covered.synthesised.length > 0) {
      coverage.dropped += covered.dropped.length;
      coverage.products++;
      coverage.synthesised += covered.synthesised.length;
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
            cProductId: product.cProductId,
          }
        );
        continue;
      }

      const peERC_general = buildStableERC('PE', [skuERC, generalList.ercKey]);

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

        const basePriceEntry = _withExistingPriceEntry(
          {
            price: entry.price,
            priceListId: generalList.id,
            externalReferenceCode: peERC_general,
            active: true,
            hasTierPrice: uniqueTierPrices.length > 0,
            skuId,
            skuExternalReferenceCode: skuERC,
          },
          existingEntriesByList.get(generalList.key)
        );

        if (uniqueTierPrices.length > 0) {
          basePriceEntry.tierPrices = uniqueTierPrices.map((tp) => ({
            minimumQuantity: tp.minimumQuantity,
            price: tp.price,
            externalReferenceCode: buildStableERC('TP', [
              skuERC,
              generalList.ercKey,
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

      if (promotionsList && entry.promoPrice) {
        const peERC_promo = buildStableERC('PE', [
          skuERC,
          promotionsList.ercKey,
        ]);

        if (!seenPriceERCs.has(peERC_promo)) {
          seenPriceERCs.add(peERC_promo);
          const promoPriceEntry = _withExistingPriceEntry(
            {
              price: entry.promoPrice,
              priceListId: promotionsList.id,
              externalReferenceCode: peERC_promo,
              active: true,
              hasTierPrice: false,
              skuId,
              skuExternalReferenceCode: skuERC,
            },
            existingEntriesByList.get(promotionsList.key)
          );

          promotionsList.priceEntries.push(promoPriceEntry);
          totalEntries++;
        }
      }
    }
  }

  // Named at a level the run shows: the derivation used to happen silently and
  // the tiers it dropped were simply absent from the catalogue (#787).
  if (coverage.products > 0) {
    this.logger.info(
      `Price entry coverage: dropped ${coverage.dropped} entr${coverage.dropped === 1 ? 'y' : 'ies'} naming a SKU Liferay does not create and derived ${coverage.synthesised} for orderable SKUs that had none, across ${coverage.products} product(s)`,
      { sessionId }
    );
  }

  const rejected = [];

  for (const pl of priceListTemplates) {
    const priceEntries = pl.priceEntries;
    if (!priceEntries || priceEntries.length === 0) continue;

    // A catalog's own base list is created by Liferay without an external
    // reference code, so those entries have to be addressed by list id.
    const priceListKey = pl.externalReferenceCode || pl.id;

    let outcome = { failures: [], written: 0 };

    const { batchERC } = await this.submitBatch(
      sessionId,
      stepKey,
      'priceLists',
      'generate',
      async (_batchERC) => {
        this.logger.info(
          `Simulating batch creation of ${priceEntries.length} price entries for list ${pl.id} directly from ProductGenerator to bypass DXP platform bugs...`,
          { sessionId }
        );

        outcome = await writeEachEntity({
          describe: (entry) => entry.skuExternalReferenceCode,
          entities: priceEntries,
          write: (entry) =>
            this.liferay.createPriceEntry(config, priceListKey, entry),
        });

        outcome.failures.forEach(({ reason, subject }) => {
          this.logger.warn(
            `Failed to create the price entry for SKU ${subject} in list ${pl.id}: ${reason}`,
            { sessionId }
          );
        });

        return {
          batchId: `simulated-batch-${Date.now()}`,
          count: outcome.written,
          status: 'completed',
        };
      },
      priceEntries.length
    );

    rejected.push(...outcome.failures);

    // `submitBatch` records a completed batch as having processed everything it
    // was handed, which is the requested count rather than the achieved one.
    // Left uncorrected, a list that lost an entry reports having written them
    // all, and the counter an operator watches says the step went perfectly
    // (#891).
    await this.persistence.updateBatch(batchERC, {
      errorCount: outcome.failures.length,
      processedCount: outcome.written,
    });
  }

  if (rejected.length > 0) {
    const named = summariseFailures(rejected);

    this.logger.warn(
      `${rejected.length} of ${totalEntries} price entries were rejected: ${named}. The run continues - the products they belong to are created and their media is unaffected (#892).`,
      { sessionId }
    );

    this.progress.stepWarning({
      correlationId: session.correlationId,
      entityType: 'priceLists',
      errorReference: createERC(ERC_PREFIX.ERROR),
      message: `${rejected.length} of ${totalEntries} price entries could not be created: ${named}. Every other price, product and attachment in this run is unaffected.`,
      operation: session.flow_type || session.flowType,
      sessionId,
      step: stepKey,
    });
  }

  if (totalEntries === 0) {
    await this.completeSyncStep(sessionId, stepKey, 'SYNCHRONOUS');
  }
}

function _isAicaPriceList(priceList) {
  return String(priceList?.externalReferenceCode || '').startsWith(
    AICA_ERC_PREFIX
  );
}

async function _readCatalogPriceLists(config, sessionId) {
  const catalogId = config.catalogId;

  try {
    // HARDENING: Pricing V2.0 strictly forbids 'catalogId eq' filters in 2025.Q1.
    // We fetch all and filter in memory to bypass "Collection not allowed" errors.
    const res = await this.liferay.getPriceLists(config, {
      catalogId,
      ignoreExclusions: true,
      pageSize: 1000,
    });

    return (res?.items || []).filter(
      (pl) => !catalogId || Number(pl.catalogId) === Number(catalogId)
    );
  } catch (err) {
    this.logger.warn(`Failed to read catalog price lists: ${err.message}`, {
      sessionId,
    });
    return [];
  }
}

async function _deleteStalePriceLists(
  config,
  catalogLists,
  ownERCs,
  sessionId
) {
  const catalogId = config.catalogId;

  // This cleanup removes lists left by EARLIER runs whose flag was never reset;
  // leaving one flagged would make it the list Liferay files Sku.price into.
  // It matches on name, but every pricing step resolves its targets, so matching
  // on name alone also matched the list the previous step created moments ago -
  // create-bulk-pricing deleted create-price-lists' list, then
  // create-tier-pricing deleted create-bulk-pricing's, each taking its price
  // entries with it. The ERCs encode the sessionId, so they identify this run's
  // own lists exactly.
  const stale = catalogLists.filter(
    (pl) =>
      !ownERCs.has(pl.externalReferenceCode) &&
      (pl.name === `AICA - Standard Prices (${catalogId})` ||
        pl.name === `AICA - Promotions (${catalogId})`)
  );

  for (const pl of stale) {
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

  return catalogLists.filter((pl) => !stale.includes(pl));
}

async function _resolvePriceListTargets(config, sessionId, { create } = {}) {
  const catalogId = config.catalogId;

  const ownERCs = new Map(
    PRICE_LIST_PURPOSES.map((purpose) => [
      purpose.key,
      buildStableERC(ERC_PREFIX.PRICE_LIST, [
        purpose.key,
        catalogId,
        sessionId,
      ]),
    ])
  );

  let catalogLists = await _readCatalogPriceLists.call(this, config, sessionId);

  if (create) {
    catalogLists = await _deleteStalePriceLists.call(
      this,
      config,
      catalogLists,
      new Set(ownERCs.values()),
      sessionId
    );
  }

  const targets = [];

  for (const purpose of PRICE_LIST_PURPOSES) {
    const ownedByLiferay = catalogLists.filter(
      (pl) => pl.type === purpose.type && !_isAicaPriceList(pl)
    );
    // The flag is the authority. The single-candidate fallback covers a catalog
    // whose flag an earlier AICA run moved away and never put back (#657).
    const adopted =
      ownedByLiferay.find((pl) => pl.catalogBasePriceList) ||
      (ownedByLiferay.length === 1 ? ownedByLiferay[0] : null);

    if (adopted) {
      targets.push({
        ...purpose,
        adopted: true,
        catalogBasePriceList: Boolean(adopted.catalogBasePriceList),
        catalogId: parseInt(catalogId, 10),
        currencyCode: config.currencyCode || 'USD',
        // Liferay's own lists have no external reference code, so price entry
        // ERCs are keyed on the catalog and purpose. They stay stable across
        // runs, which turns a rerun into an update rather than a collision.
        ercKey: buildStableERC(ERC_PREFIX.PRICE_LIST, [purpose.key, catalogId]),
        externalReferenceCode: adopted.externalReferenceCode || null,
        id: adopted.id,
        name: adopted.name,
      });
      continue;
    }

    const erc = ownERCs.get(purpose.key);
    const name = `AICA - ${purpose.label} (${catalogId})`;

    let existing = await this.liferay.getPriceListByERC(config, erc);
    let created = false;

    if (!existing && create) {
      created = true;
      existing = await this.liferay.createPriceList(config, {
        externalReferenceCode: erc,
        name,
        currencyCode: config.currencyCode || 'USD',
        active: true,
        priority: purpose.priority,
        catalogId,
        type: purpose.type,
        catalogBasePriceList: false,
        // Deliberate: an expired price list leaves the catalogue unpriced and
        // nothing re-creates it. See PR #688.
        neverExpire: true,
      });
    }

    targets.push({
      ...purpose,
      adopted: false,
      catalogBasePriceList: Boolean(existing?.catalogBasePriceList),
      catalogId: parseInt(catalogId, 10),
      created,
      currencyCode: config.currencyCode || 'USD',
      ercKey: erc,
      externalReferenceCode: erc,
      id: existing?.id,
      name,
    });
  }

  return { catalogLists, targets };
}

/**
 * Liferay files Sku.price into the catalog's base list as an upsert keyed on
 * (price list, SKU, unit of measure), while the pricing API matches on the
 * external reference code alone - so posting AICA's entry into a list that
 * already holds Liferay's ERC-less one would leave two rows for one SKU.
 * PriceEntryResourceImpl honours priceEntryId ahead of the ERC, so naming the
 * row AICA is replacing keeps the list to one entry per SKU.
 */
async function _indexPriceEntriesBySku(config, priceList, sessionId) {
  const bySku = new Map();

  if (priceList.created) return bySku;

  try {
    const res = await this.liferay.getPriceEntries(config, priceList.id, {
      pageSize: 1000,
    });

    for (const entry of res?.items || []) {
      if (!entry.priceEntryId) continue;
      if (entry.skuExternalReferenceCode)
        bySku.set(entry.skuExternalReferenceCode, entry.priceEntryId);
      if (entry.skuId != null)
        bySku.set(String(entry.skuId), entry.priceEntryId);
    }
  } catch (err) {
    this.logger.warn(
      `Failed to read existing price entries for list ${priceList.id}: ${err.message}`,
      { sessionId }
    );
  }

  return bySku;
}

function _withExistingPriceEntry(priceEntry, bySku) {
  const priceEntryId =
    bySku?.get(priceEntry.skuExternalReferenceCode) ??
    bySku?.get(String(priceEntry.skuId));

  return priceEntryId ? { ...priceEntry, priceEntryId } : priceEntry;
}

module.exports = {
  runGeneratePriceListsStep,
  runGenerateBulkPricingStep,
  runGenerateTierPricingStep,
  runUpdateCatalogConfigurationStep,
};
