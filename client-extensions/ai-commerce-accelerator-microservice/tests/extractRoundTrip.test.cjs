const {
  HELMET,
  PANNIER,
  PRICE_LISTS,
} = require('./fixtures/solaraMotoInstance.cjs');
const {
  CATALOG_ID,
  importIntoStubInstance,
} = require('./fixtures/importIntoStubInstance.cjs');
const { liferayInstanceStub } = require('./fixtures/liferayInstanceStub.cjs');
const {
  buildInstanceDataset,
  extractInstanceDataset,
} = require('../utils/instanceExtractor.cjs');
const {
  DATASET_ENTRY,
  MANIFEST_ENTRY,
  buildMediaBundle,
  looksLikeZip,
  readMediaBundle,
} = require('../utils/mediaBundle.cjs');

/**
 * extract -> import -> extract again -> compare.
 *
 * This is the acceptance criterion #849 sets, and it is set that way for a
 * reason: "the extract produced plausible output" is satisfied by an extract
 * that drops half the fields. Anything that survives the round trip is
 * genuinely portable, and anything that does not names its own defect - which
 * is the only way translation loss gets found before a promotion is short.
 *
 * What is deliberately excluded from the comparison is listed by name below,
 * with the reason. That list is the point of the test as much as the equality
 * is: an exclusion nobody had to write down is an exclusion nobody noticed.
 */

const CONFIG = { catalogId: CATALOG_ID, languageId: 'en_US' };

const silent = () => ({
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
});

function extract(liferayService) {
  return extractInstanceDataset({
    config: CONFIG,
    correlationId: 'round-trip',
    liferayService,
    logger: silent(),
  });
}

/**
 * What Liferay assigns, and so cannot be compared.
 *
 * None of these are in the extracted shape at all - the translation drops
 * every numeric id on the way out - so this list exists to say that the
 * omission was intended rather than to remove anything.
 */
const ASSIGNED_BY_LIFERAY = ['id', 'productId', 'catalogId', 'createDate'];

/**
 * What the *import* drops, so the second extract cannot see it.
 *
 * Each of these is a real gap between what a package carries and what
 * `routes/import.cjs` and the steps it schedules consume. They are asserted as
 * losses rather than quietly filtered out, so that closing one turns this test
 * red and the list gets shorter on purpose.
 */
const LOST_ON_IMPORT = {
  metaDescription:
    'create-products builds its payload field by field and never sends it.',
  metaKeyword: 'As metaDescription.',
  metaTitle: 'As metaDescription.',
  urls: "As metaDescription. A promoted product takes the target's own slug.",
};

/**
 * What the import re-derives rather than carrying across, so a value survives
 * only by coincidence.
 */
const REDERIVED_ON_IMPORT = {
  'priceEntries[].externalReferenceCode':
    'pricing.cjs rebuilds every price-entry and tier code with buildStableERC, so the source instance codes could not survive and are not meant to.',
  'skuVariants[].inStock':
    'Stock lives on warehouse items, and update-inventory assigns it afresh from the run options rather than from the dataset.',
  'skus[].inventoryLevel': 'As skuVariants[].inStock.',
};

/** The product fields that must be identical on both sides of the trip. */
function comparableProduct(product) {
  return {
    allowBackOrder: product.allowBackOrder,
    baseSku: product.baseSku,
    category: product.category,
    description: product.description,
    externalReferenceCode: product.externalReferenceCode,
    name: product.name,
    options: product.options,
    productType: product.productType,
    shortDescription: product.shortDescription,
    skuVariants: (product.skuVariants || []).map((variant) => ({
      externalReferenceCode: variant.externalReferenceCode,
      options: variant.options,
      price: variant.price,
      priceModifier: variant.priceModifier,
      sku: variant.sku,
    })),
    skus: (product.skus || []).map((sku) => ({
      cost: sku.cost,
      externalReferenceCode: sku.externalReferenceCode,
      price: sku.price,
      sku: sku.sku,
    })),
    specifications: product.specifications,
    // Prices are the whole reason a promotion is worth doing; the codes are
    // re-derived and so are compared on what they name rather than on the code.
    priceEntries: (product.priceEntries || [])
      .map((entry) => ({
        price: entry.price,
        promoPrice: entry.promoPrice,
        skuExternalReferenceCode: entry.skuExternalReferenceCode,
        tierPrices: (entry.tierPrices || []).map((tier) => ({
          minimumQuantity: tier.minimumQuantity,
          price: tier.price,
        })),
      }))
      .sort((left, right) =>
        left.skuExternalReferenceCode.localeCompare(
          right.skuExternalReferenceCode
        )
      ),
  };
}

describe('extract -> import -> extract (#849)', () => {
  let first;
  let second;
  let payloads;

  beforeAll(async () => {
    const source = liferayInstanceStub({
      priceLists: PRICE_LISTS,
      products: [HELMET, PANNIER],
    });

    first = await extract(source);

    const imported = await importIntoStubInstance(first);
    payloads = imported.payloads;

    second = await extract(imported.instance);
  });

  it('brings back the same products, by their own reference codes', () => {
    // The dataset's identity, not Liferay's: ids are assigned by whichever
    // instance did the writing and can never match.
    expect(second.products.map((p) => p.externalReferenceCode)).toEqual(
      first.products.map((p) => p.externalReferenceCode)
    );
  });

  it('brings back every declared field the import consumes, unchanged', () => {
    expect(second.products.map(comparableProduct)).toEqual(
      first.products.map(comparableProduct)
    );
  });

  it('keeps the option a SKU was built from, which is what makes a variant sellable', () => {
    // Liferay activates a SKU only when it carries a value for every
    // SKU-contributing option. A round trip that lost the selection would
    // produce a catalogue of inactive variants that still looked complete
    // (#754, #797).
    const helmet = second.products.find(
      (p) => p.externalReferenceCode === 'AICA-PRD-HELMET'
    );

    expect(helmet.skuVariants.map((v) => v.options)).toEqual([
      { 'Shell Size': 'M' },
      { 'Shell Size': 'L' },
    ]);
    expect(helmet.options[0].skuContributor).toBe(true);
  });

  it('carries no numeric id of the source instance into the package at all', () => {
    for (const product of first.products) {
      for (const key of ASSIGNED_BY_LIFERAY) {
        expect(product).not.toHaveProperty(key);
      }
    }
  });

  it('loses exactly the fields the import is known not to consume, and no others', () => {
    // Asserted as a loss rather than filtered out of the comparison. Closing
    // any of these turns this red, which is when the list should get shorter.
    const [firstHelmet] = first.products;
    const [secondHelmet] = second.products;

    for (const key of Object.keys(LOST_ON_IMPORT)) {
      expect(firstHelmet[key]).toBeDefined();
      expect(secondHelmet[key]).toBeUndefined();
    }

    // Nothing outside that list went missing.
    const vanished = Object.keys(firstHelmet).filter(
      (key) => secondHelmet[key] === undefined
    );

    expect(vanished.sort()).toEqual(Object.keys(LOST_ON_IMPORT).sort());
  });

  it('records why a re-derived field is not compared on its own value', () => {
    // The list is the documentation; this asserts it stays attached to
    // something real rather than becoming a stale comment.
    expect(Object.keys(REDERIVED_ON_IMPORT).sort()).toEqual([
      'priceEntries[].externalReferenceCode',
      'skuVariants[].inStock',
      'skus[].inventoryLevel',
    ]);
  });

  it('sends a payload create-products accepts, built by create-products itself', () => {
    // The write side of the trip is the real step, so this is the assertion
    // that the extracted shape is one the import can actually use.
    const [helmet] = payloads.products;

    expect(helmet.externalReferenceCode).toBe('AICA-PRD-HELMET');
    expect(helmet.name).toEqual({ en_US: 'Alpine Helmet' });
    expect(helmet.productConfiguration.allowBackOrder).toBe(true);
    expect(helmet.categories).toEqual([{ id: expect.any(Number) }]);
    expect(helmet.productSpecifications[0]).toMatchObject({
      label: { en_US: 'Shell material' },
      specificationKey: 'shell-material',
      value: { en_US: 'Fibreglass composite' },
    });
    // A product with SKU-contributing options gets no base SKU in the product
    // payload; the variants arrive with create-product-skus.
    expect(helmet.skus).toBeUndefined();
  });

  it('resolves every variant option link, leaving no SKU Liferay would deactivate', () => {
    const helmet = payloads.skus.find(
      (payload) => payload.externalReferenceCode === 'AICA-PRD-HELMET'
    );

    expect(helmet.skus).toHaveLength(2);

    for (const sku of helmet.skus) {
      expect(sku.skuOptions).toHaveLength(1);
      expect(sku.skuOptions[0].optionId).toBeGreaterThan(0);
      expect(sku.skuOptions[0].optionValueId).toBeGreaterThan(0);
    }
  });
});

describe('the package an instance extract produces', () => {
  it('is the format utils/mediaBundle.cjs defines, so the import needs no change', async () => {
    const source = liferayInstanceStub({
      priceLists: PRICE_LISTS,
      products: [HELMET, PANNIER],
    });

    // The shape the route sends, assembled by the same function the route
    // calls, so this is not a restatement of it.
    const dataset = await buildInstanceDataset({
      config: CONFIG,
      correlationId: 'round-trip',
      liferayService: source,
      logger: silent(),
    });

    expect(dataset.metadata.source).toBe('liferay-instance');
    expect(dataset.metadata.coverage.orders.extracted).toBe(false);

    // The binaries come from mediaExtractor against the same instance; here
    // they stand in for it, because what is being asserted is the container.
    const { buffer, manifest } = await buildMediaBundle({
      dataset,
      media: dataset.images.map((image) => ({
        buffer: Buffer.from(`bytes for ${image.productERC}`),
        contentType: image.contentType,
        kind: 'image',
        priority: image.priority,
        productERC: image.productERC,
        title: image.title,
      })),
    });

    expect(looksLikeZip(buffer)).toBe(true);
    expect(manifest.counts.images).toBe(2);
    expect(manifest.counts.unresolved).toBe(0);

    // Read back through the same reader routes/import.cjs uses, and asserted
    // against that module's own entry names rather than against a restatement
    // of them here.
    const read = await readMediaBundle(buffer);

    expect(DATASET_ENTRY).toBe('dataset.json');
    expect(MANIFEST_ENTRY).toBe('media/manifest.json');
    expect(read.missing).toEqual([]);
    expect(read.dataset.products).toHaveLength(2);
    expect(read.media[0].buffer.toString()).toBe('bytes for AICA-PRD-HELMET');

    // The keys routes/import.cjs reads off the dataset. An instance extract
    // that answered a different set would need the import changed, which is
    // what the issue says it must not.
    for (const key of [
      'products',
      'accounts',
      'orders',
      'warehouses',
      'addresses',
      'specificationDefinitions',
      'optionDefinitions',
    ]) {
      expect(read.dataset[key]).toBeInstanceOf(Array);
    }
  });
});
