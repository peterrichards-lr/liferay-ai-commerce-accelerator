const {
  HELMET,
  PANNIER,
  PRICE_LISTS,
  WAREHOUSES,
} = require('./fixtures/solaraMotoInstance.cjs');
const { liferayInstanceStub } = require('./fixtures/liferayInstanceStub.cjs');
const {
  SDK_COLLECTION_CEILING,
  TruncatedExtractError,
  extractInstanceDataset,
} = require('../utils/instanceExtractor.cjs');
const {
  AICA_OWNED,
  EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
} = require('../utils/ownershipScope.cjs');

// #849: a dataset could only come from a run, and a `clean` destroyed the run
// this promotion needed (#868). These tests cover the reads that make an
// instance a source in its own right - and above all the refusals, because an
// extract that silently drops rows is the defect the issue is about.

const CONFIG = { catalogId: 61432, languageId: 'en_US' };

const logger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
});

function extract(liferayService, options = {}) {
  return extractInstanceDataset({
    config: CONFIG,
    correlationId: 'test-correlation-id',
    liferayService,
    logger: logger(),
    ...options,
  });
}

describe('extracting a dataset from an instance', () => {
  let instance;

  beforeEach(() => {
    instance = liferayInstanceStub({
      priceLists: PRICE_LISTS,
      products: [HELMET, PANNIER],
      warehouses: WAREHOUSES,
    });
  });

  it('produces the generation shape, keyed on the external reference codes', async () => {
    const dataset = await extract(instance);

    expect(dataset.products.map((p) => p.externalReferenceCode)).toEqual([
      'AICA-PRD-HELMET',
      'AICA-PRD-PANNIER',
    ]);
  });

  it('reads each SKU again, because the product sweep projects them away', async () => {
    // getProductsWithSkus keeps { sku, purchasable, price,
    // externalReferenceCode } and drops skuOptions. Without a second read
    // every variant would look like a base SKU and the options would be lost
    // from the promoted catalogue.
    const dataset = await extract(instance);

    expect(instance.calls.getSkusByERC).toEqual([
      ['AICA-HELMET-M', 'AICA-HELMET-L'],
      ['AICA-PANNIER-STD'],
    ]);

    const helmet = dataset.products[0];
    expect(helmet.skuVariants).toHaveLength(2);
    expect(helmet.skuVariants[0].options).toEqual({ 'Shell Size': 'M' });
    expect(helmet.skus[0].sku).toBe('AICA-HELMET');
  });

  it('joins the base list and the promotion onto one price entry per SKU', async () => {
    // Liferay files Sku.price in the catalog's base price list and
    // Sku.promoPrice in the base promotion, and the generation shape carries
    // both on a single entry.
    const [helmet] = (await extract(instance)).products;

    const medium = helmet.priceEntries.find(
      (entry) => entry.skuExternalReferenceCode === 'AICA-HELMET-M'
    );

    expect(medium).toMatchObject({
      price: 240,
      priceListExternalReferenceCode: 'PL-GENERAL',
      promoPrice: 199,
    });
    expect(medium.tierPrices).toEqual([
      {
        externalReferenceCode: 'TP-HELMET-M-10',
        minimumQuantity: 10,
        price: 216,
      },
    ]);
  });

  it('carries the media metadata in the shape createdImages holds', async () => {
    const dataset = await extract(instance);

    expect(dataset.images).toEqual([
      {
        contentType: 'image/webp',
        priority: 1,
        productERC: 'AICA-PRD-HELMET',
        title: { en_US: 'Alpine Helmet' },
      },
      {
        contentType: 'image/webp',
        priority: 1,
        productERC: 'AICA-PRD-PANNIER',
        title: { en_US: 'Pannier Liner' },
      },
    ]);
    expect(dataset.pdfs).toEqual([
      {
        contentType: 'application/pdf',
        priority: 1,
        productERC: 'AICA-PRD-HELMET',
        title: { en_US: 'Alpine Helmet manual' },
      },
    ]);
  });

  it('says which dataset keys it did not attempt at all', async () => {
    // An empty `orders` array must not be readable as "this instance has no
    // orders". The package says which of the two it means.
    const dataset = await extract(instance);

    expect(dataset.coverage.products.extracted).toBe(true);
    expect(dataset.coverage.orders.extracted).toBe(false);
    expect(dataset.coverage.accounts.extracted).toBe(false);
    expect(dataset.coverage.addresses.extracted).toBe(false);
  });
});

describe('ownership scope', () => {
  it('defaults to AICA-owned, which is the round-trip case', async () => {
    const instance = liferayInstanceStub({
      products: [HELMET, PANNIER],
      warehouses: WAREHOUSES,
    });

    const dataset = await extract(instance);

    expect(dataset.scope).toBe(AICA_OWNED);
    expect(dataset.warehouses.map((w) => w.externalReferenceCode)).toEqual([
      'AICA-WH-LONDON',
    ]);
  });

  it('takes in a catalogue nobody generated when asked explicitly', async () => {
    const instance = liferayInstanceStub({
      products: [HELMET, PANNIER],
      warehouses: WAREHOUSES,
    });

    const dataset = await extract(instance, {
      ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
    });

    expect(dataset.warehouses.map((w) => w.externalReferenceCode)).toEqual([
      'AICA-WH-LONDON',
      'CUSTOMER-WH-ROTTERDAM',
    ]);
  });

  it('refuses a scope that arrived as a string rather than as one of the objects', async () => {
    const instance = liferayInstanceStub({ products: [] });

    await expect(
      extract(instance, { ownershipScope: 'everything' })
    ).rejects.toThrow(TypeError);
  });
});

describe('refusing to truncate', () => {
  it('refuses when the product read comes back at the ceiling the SDK slices at', async () => {
    // _collectAllItems stops at 5000 items and says nothing, so a read of
    // exactly that length is indistinguishable from one that was cut off. The
    // only safe reading is the pessimistic one: a package built from a
    // truncated read looks complete and is not.
    const instance = liferayInstanceStub({ products: [] });

    instance.getProductsWithSkus = async () => ({
      items: Array.from({ length: SDK_COLLECTION_CEILING }, (_, index) => ({
        externalReferenceCode: `AICA-PRD-${index}`,
        productId: index,
        skus: [],
      })),
      totalCount: SDK_COLLECTION_CEILING,
    });

    await expect(extract(instance)).rejects.toThrow(TruncatedExtractError);
  });

  it('walks every page of a price list rather than keeping the first', async () => {
    // getPriceEntries is a single-page reader by design, and it is the one
    // collection whose totalCount is Liferay's own rather than the SDK's row
    // count - so it is the one place a real completeness check is possible.
    const entries = Array.from({ length: 450 }, (_, index) => ({
      externalReferenceCode: `PE-${index}`,
      price: 10 + index,
      skuExternalReferenceCode: `AICA-SKU-${index}`,
      tierPrices: [],
    }));

    const instance = liferayInstanceStub({
      priceLists: [
        {
          catalogId: 61432,
          entries,
          externalReferenceCode: 'PL-GENERAL',
          id: 30001,
          type: 'price-list',
        },
      ],
      products: [],
    });

    await extract(instance);

    expect(instance.calls.getPriceEntries.map((call) => call.page)).toEqual([
      1, 2, 3,
    ]);
  });

  it('refuses when a price list reports more entries than it will hand over', async () => {
    const instance = liferayInstanceStub({ products: [] });

    instance.getPriceLists = async () => ({
      items: [
        { externalReferenceCode: 'PL-GENERAL', id: 30001, type: 'price-list' },
      ],
      totalCount: 1,
    });
    // An instance that ignores `page` answers every request with page one.
    instance.getPriceEntries = async () => ({
      items: [
        {
          externalReferenceCode: 'PE-1',
          price: 1,
          skuExternalReferenceCode: 'S',
        },
      ],
      totalCount: 9000,
    });

    await expect(extract(instance)).rejects.toThrow(TruncatedExtractError);
  });
});

describe('a product read that fails part way', () => {
  it('costs that product its own detail and nothing else', async () => {
    // The whole-catalogue reads refuse rather than truncate. One product's
    // options failing is not the same event: abandoning there would lose every
    // product already read, and the translation report names the loss.
    const instance = liferayInstanceStub({
      priceLists: PRICE_LISTS,
      products: [HELMET, PANNIER],
    });

    instance.getProductSpecifications = async (_config, productId) => {
      if (productId === HELMET.product.productId) {
        throw new Error('503 from the specifications endpoint');
      }
      return PANNIER.specifications;
    };

    const dataset = await extract(instance);

    expect(dataset.products).toHaveLength(2);
    expect(dataset.products[0].specifications).toEqual([]);
    expect(dataset.products[1].specifications).toHaveLength(1);
  });
});
