const {
  DATASET_COVERAGE,
  translateProduct,
  translateWarehouse,
} = require('./datasetTranslation.cjs');
const { AICA_OWNED, resolveOwnershipScope } = require('./ownershipScope.cjs');

/**
 * Reads a dataset out of a live Liferay instance.
 *
 * A dataset could only ever come from a run: `routes/export.cjs` reads the
 * session context, so an instance holding commerce data could not produce one
 * at all. That was a gap until a `clean` destroyed the session for a completed
 * UAT run (#868) and made this the only route to the promotion it was the
 * source for. See #849.
 *
 * The reads are the cheap half. `utils/datasetTranslation.cjs` holds the hard
 * half - the DTO shape is not the generation shape - and this module's job is
 * to fetch exactly what that translation declares it needs, once per product,
 * and to refuse rather than to truncate.
 *
 * Sequential on purpose, like `mediaExtractor`. Extract is a rare,
 * operator-initiated action against an instance somebody is usually working
 * on; being slow costs less than a burst of parallel reads against it.
 */

/**
 * The point of the whole issue: an extract that silently drops rows.
 *
 * The SDK's collecting readers answer `{ items, totalCount }` where
 * `totalCount` is `items.length` - it is computed after in-memory exclusion
 * filtering, so it can never disagree with the list and is worthless as a
 * completeness check. What they do have is a ceiling: `_collectAllItems` stops
 * at 5000 items and slices, saying nothing. So a read that comes back at
 * exactly the ceiling is indistinguishable from one that was cut off, and the
 * only safe reading of that is the pessimistic one.
 *
 * `getPriceEntries` is the exception and is checked properly below: it returns
 * Liferay's own page envelope, so its `totalCount` is real.
 */
const SDK_COLLECTION_CEILING = 5000;

class TruncatedExtractError extends Error {
  constructor(what, returned) {
    super(
      `Refusing to extract: the ${what} read returned ${returned} rows, the ceiling the SDK silently slices at. ` +
        'A package built from a truncated read looks complete and is not, which is the defect #849 exists to prevent.'
    );
    this.name = 'TruncatedExtractError';
  }
}

function refuseIfAtCeiling(what, items) {
  if (Array.isArray(items) && items.length >= SDK_COLLECTION_CEILING) {
    throw new TruncatedExtractError(what, items.length);
  }

  return items;
}

/** The SDK answers some readers with a bare array and some with an envelope. */
function itemsOf(response) {
  if (Array.isArray(response)) return response;
  return response?.items || [];
}

/**
 * Every price entry in one list, walked to the end of Liferay's own count.
 *
 * This is the one collection whose reader hands back the raw page envelope, so
 * `totalCount` is what Liferay reported rather than what the SDK returned. The
 * loop is here rather than in the SDK because `getPriceEntries` is documented
 * as a single-page reader and changing that would change its contract for
 * everyone (#200).
 */
async function readAllPriceEntries({
  config,
  liferayService,
  logger,
  pageSize = 200,
  priceListId,
}) {
  const entries = [];
  let page = 1;
  let totalCount = 0;

  // The same ceiling the SDK applies, for the same reason: an instance that
  // ignores `page` answers every request with page one, and the loop would
  // otherwise never reach totalCount.
  const maxPages = Math.ceil(SDK_COLLECTION_CEILING / pageSize) + 1;

  while (page <= maxPages) {
    const response = await liferayService.getPriceEntries(config, priceListId, {
      page,
      pageSize,
    });

    const pageItems = itemsOf(response);
    totalCount = Number(response?.totalCount ?? pageItems.length);
    entries.push(...pageItems);

    if (pageItems.length === 0 || entries.length >= totalCount) {
      return entries;
    }

    page++;
  }

  logger?.error?.(
    `Price list ${priceListId} reported ${totalCount} entries and stopped at ${entries.length}`,
    { priceListId, returned: entries.length, totalCount }
  );

  throw new TruncatedExtractError(
    `price entries for list ${priceListId}`,
    entries.length
  );
}

/**
 * Every price entry in the catalogue, indexed by the SKU code it names.
 *
 * The promotional half is a second list rather than a second field: Liferay
 * files `Sku.price` in the catalog's base price list and `Sku.promoPrice` in
 * the base promotion, and the generation shape carries both on one entry. So
 * the two are read separately and joined here, keyed on the SKU.
 */
async function readPriceEntriesBySku({ config, liferayService, logger }) {
  const priceLists = itemsOf(
    await liferayService.getPriceLists(config, {
      catalogId: config.catalogId,
      pageSize: 200,
    })
  );

  refuseIfAtCeiling('price lists', priceLists);

  const bySku = new Map();

  for (const priceList of priceLists) {
    if (!priceList?.id) continue;

    const isPromotion =
      String(priceList.type || '').toLowerCase() === 'promotion';

    const entries = await readAllPriceEntries({
      config,
      liferayService,
      logger,
      priceListId: priceList.id,
    });

    for (const entry of entries) {
      const skuCode = entry?.skuExternalReferenceCode;

      if (!skuCode) continue;

      const existing = bySku.get(skuCode) || {};

      if (isPromotion) {
        bySku.set(skuCode, { ...existing, promoPrice: entry.price });
        continue;
      }

      bySku.set(skuCode, {
        ...existing,
        bulkPricing: entry.bulkPricing === true,
        externalReferenceCode: entry.externalReferenceCode,
        price: entry.price,
        priceListExternalReferenceCode: priceList.externalReferenceCode,
        skuExternalReferenceCode: skuCode,
        tierPrices: (entry.tierPrices || []).map((tier) => ({
          externalReferenceCode: tier.externalReferenceCode,
          minimumQuantity: tier.minimumQuantity,
          price: tier.price,
          ...(tier.promoPrice === undefined || tier.promoPrice === null
            ? {}
            : { promoPrice: tier.promoPrice }),
        })),
      });
    }
  }

  return bySku;
}

/**
 * A product's SKUs in full.
 *
 * `getProductsWithSkus` answers with `{ sku, purchasable, price,
 * externalReferenceCode }` and nothing else - it projects the SKU down on the
 * way past - so `cost`, `inventoryLevel` and above all `skuOptions` have to be
 * read again. Without `skuOptions` there is no way to tell a variant from a
 * base SKU, and every variant would be extracted as a base one: a promoted
 * catalogue of single-SKU products with the options thrown away.
 */
async function readSkuDetail({ config, liferayService, logger, skuStubs }) {
  const ercs = skuStubs
    .map((sku) => sku?.externalReferenceCode || sku?.sku)
    .filter(Boolean);

  if (ercs.length === 0) return [];

  const detailed = itemsOf(await liferayService.getSkusByERC(config, ercs));

  // getSkusByERC drops the ones it could not read rather than failing, so the
  // shortfall is said here. The stub is kept for a SKU that could not be
  // detailed: a SKU with a code and a price is worth more than no SKU, and it
  // reads as a base SKU, which is what it looks like from the projection.
  if (detailed.length < ercs.length) {
    const found = new Set(detailed.map((sku) => sku.externalReferenceCode));
    const missed = skuStubs.filter(
      (sku) => !found.has(sku.externalReferenceCode || sku.sku)
    );

    logger?.warn?.(
      `Could not read the full record for ${missed.length} of ${ercs.length} SKUs; they are extracted as base SKUs without their options`,
      { externalReferenceCodes: missed.slice(0, 5).map((s) => s.sku) }
    );

    return [...detailed, ...missed];
  }

  return detailed;
}

/**
 * One product, translated, with whatever the instance could not answer named.
 */
async function extractProduct({
  config,
  liferayService,
  locale,
  logger,
  product,
}) {
  const productId = product.productId || product.id;
  const productERC = product.externalReferenceCode;

  const [options, specifications, images, attachments, skus] =
    await Promise.all([
      readOrWarn(
        () => liferayService.getProductOptions(config, productId),
        `options for ${productERC}`,
        logger
      ),
      readOrWarn(
        () => liferayService.getProductSpecifications(config, productId),
        `specifications for ${productERC}`,
        logger
      ),
      readOrWarn(
        () => liferayService.getProductImages(config, productERC),
        `image metadata for ${productERC}`,
        logger
      ),
      readOrWarn(
        () => liferayService.getProductAttachments(config, productERC),
        `attachment metadata for ${productERC}`,
        logger
      ),
      readSkuDetail({
        config,
        liferayService,
        logger,
        skuStubs: product.skus || [],
      }),
    ]);

  return {
    attachments: itemsOf(attachments),
    images: itemsOf(images),
    options: itemsOf(options),
    product,
    skus,
    specifications: itemsOf(specifications),
    translate: (priceEntries) =>
      translateProduct(
        {
          attachments: itemsOf(attachments),
          images: itemsOf(images),
          options: itemsOf(options),
          priceEntries,
          product,
          skus,
          specifications: itemsOf(specifications),
        },
        { locale }
      ),
  };
}

/**
 * A per-product read that costs its own product's detail and nothing else.
 *
 * The whole-catalogue reads refuse rather than truncate, because a short
 * product list is a short package. A single product's options failing is not
 * the same event: abandoning the extract there would lose the twenty-one
 * products already read, and the translation report names what is missing
 * anyway. Same rule `mediaExtractor` applies per attachment (#822).
 */
async function readOrWarn(read, what, logger) {
  try {
    return (await read()) || [];
  } catch (error) {
    logger?.warn?.(
      `[InstanceExtractor] Could not read ${what}: ${error?.message}`
    );
    return [];
  }
}

/**
 * Everything a package's product half needs, read from `config`'s instance.
 *
 * `ownershipScope` decides what belongs to the dataset. It defaults to AICA's
 * own codes, which is the round-trip case; widening it to a catalogue nobody
 * generated is #850's job and is deliberately not expressible in a request
 * body without the confirmation phrase.
 */
async function extractInstanceDataset({
  config,
  correlationId,
  liferayService,
  locale = 'en_US',
  logger,
  ownershipScope,
}) {
  const scope = resolveOwnershipScope(ownershipScope);

  logger?.info?.('Reading a dataset from the instance', {
    catalogId: config.catalogId,
    correlationId,
    operation: 'extract-instance-dataset',
    ownershipScope: scope.id,
  });

  // Throws rather than answering with products carrying no SKUs, which is what
  // makes it the right entry point here: a package of SKU-less products would
  // import into an unsellable catalogue and report success (SDK #199).
  const allProducts = itemsOf(
    await liferayService.getProductsWithSkus(config, {
      catalogId: config.catalogId,
    })
  );

  refuseIfAtCeiling('products', allProducts);

  const products = allProducts.filter((product) =>
    scope.owns(product?.externalReferenceCode)
  );

  logger?.info?.(
    `${products.length} of ${allProducts.length} products are in scope (${scope.label})`,
    { correlationId, operation: 'extract-instance-dataset' }
  );

  const priceEntriesBySku = await readPriceEntriesBySku({
    config,
    liferayService,
    logger,
  });

  const translated = [];
  const media = { images: [], pdfs: [] };
  const translationReport = [];

  for (const product of products) {
    const read = await extractProduct({
      config,
      liferayService,
      locale,
      logger,
      product,
    });

    const priceEntries = [...(product.skus || []), ...read.skus]
      .map((sku) =>
        priceEntriesBySku.get(sku?.externalReferenceCode || sku?.sku)
      )
      .filter(Boolean);

    const { missing, product: generationShape } = read.translate(
      dedupeByErc(priceEntries)
    );

    translated.push(generationShape);

    if (missing.length > 0) {
      translationReport.push({
        externalReferenceCode: product.externalReferenceCode,
        missing,
      });
    }

    media.images.push(
      ...read.images.map((image) => mediaRecord(image, product))
    );
    media.pdfs.push(
      ...read.attachments.map((attachment) => mediaRecord(attachment, product))
    );
  }

  const warehouses = await readWarehouses({
    config,
    liferayService,
    locale,
    scope,
  });

  return {
    coverage: DATASET_COVERAGE,
    images: media.images,
    pdfs: media.pdfs,
    products: translated,
    scope,
    translationReport,
    warehouses,
  };
}

function dedupeByErc(entries) {
  return [
    ...new Map(
      entries.map((entry) => [entry.skuExternalReferenceCode, entry])
    ).values(),
  ];
}

/**
 * The media metadata shape `createdImages` and `createdPdfs` hold, so the
 * dataset's media keys read the same whichever producer built the package.
 */
function mediaRecord(attachment, product) {
  return {
    contentType: attachment.contentType || null,
    priority: attachment.priority ?? 1,
    productERC: product.externalReferenceCode,
    title: attachment.title ?? null,
  };
}

async function readWarehouses({ config, liferayService, locale, scope }) {
  const warehouses = itemsOf(
    await liferayService.getWarehouses(config, { pageSize: 200 })
  );

  refuseIfAtCeiling('warehouses', warehouses);

  return warehouses
    .filter((warehouse) => scope.owns(warehouse?.externalReferenceCode))
    .map((warehouse) => translateWarehouse(warehouse, { locale }));
}

/**
 * An instance read into the shape `routes/export.cjs` emits from a session.
 *
 * Every key `datasetFromSession` produces appears here, including the ones an
 * instance cannot answer, because `routes/import.cjs` reads the dataset by key
 * and a package that is a different shape depending on who built it is a
 * package with two consumers. What differs is `metadata.coverage`, which says
 * which of those keys were attempted at all - an empty `orders` array must not
 * be readable as "this instance has no orders" (#849).
 *
 * It lives here rather than in the route so that the shape has one definition
 * and the round-trip test asserts the same one the route sends.
 */
async function buildInstanceDataset({
  config,
  correlationId,
  liferayService,
  locale,
  logger,
  ownershipScope,
}) {
  const extracted = await extractInstanceDataset({
    config,
    correlationId,
    liferayService,
    locale: locale || (config.languageId || 'en_US').replace('-', '_'),
    logger,
    ownershipScope,
  });

  return {
    metadata: {
      source: 'liferay-instance',
      catalogId: config.catalogId ?? null,
      coverage: extracted.coverage,
      ownershipScope: extracted.scope.id,
      // Named in the artefact rather than only in the log, for the reason the
      // media manifest names what it could not resolve: the person running the
      // import is usually not the person who built the package.
      translationReport: extracted.translationReport,
    },
    products: extracted.products,
    accounts: [],
    orders: [],
    addresses: [],
    warehouses: extracted.warehouses,
    specificationDefinitions: [],
    optionDefinitions: [],
    defaultSpecificationCategory: null,
    images: extracted.images,
    pdfs: extracted.pdfs,
    groundingMetadata: null,
    exportedAt: new Date().toISOString(),
  };
}

module.exports = {
  AICA_OWNED,
  SDK_COLLECTION_CEILING,
  TruncatedExtractError,
  buildInstanceDataset,
  extractInstanceDataset,
  readAllPriceEntries,
  readPriceEntriesBySku,
};
