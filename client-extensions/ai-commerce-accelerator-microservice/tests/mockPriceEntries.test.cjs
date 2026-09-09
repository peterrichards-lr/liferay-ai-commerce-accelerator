const MockDataGenerator = require('../generators/mockDataGenerator.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const { orderableSkusFor } = require('../utils/orderableSkus.cjs');

/**
 * A price entry may only name a SKU Liferay creates, and must carry the whole
 * of its product's decoration.
 *
 * The generator used to emit one entry against the base SKU plus one per
 * variant, and hang bulk and tier prices on the base entry alone. Liferay
 * creates no base SKU for a product with SKU-contributing options, so
 * `pricing.cjs` refused that entry for having no resolvable id - and since it
 * selects tier candidates by `tierPrices` being non-empty, it was also the only
 * candidate. Ticking Bulk or Tier Pricing therefore generated the tiers and
 * discarded them for every product with variants. See #782.
 *
 * These are the two halves of the invariant, asserted over the generator's real
 * output rather than a hand-built product, plus a run through the pricing step
 * itself - which is where the tiers were being lost.
 */

const CATALOG_ID = 987;
const REQUEST_CONFIG = { catalogId: CATALOG_ID };

const mock = new MockDataGenerator({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

const generate = (options) =>
  mock.generateProductData('Electronics', 3, REQUEST_CONFIG, null, ['en-US'], {
    catalogId: CATALOG_ID,
    generatePriceLists: true,
    ...options,
  });

const skuCodesOf = (product) =>
  orderableSkusFor(product).map((sku) => sku.externalReferenceCode || sku.sku);

// pricing.cjs:86 - the predicate the tier step selects entries by. Duplicated
// deliberately: it is the contract this generator has to satisfy, and a test
// that reproduced it from the generator's own output would assert nothing.
const isTierCandidate = (entry) =>
  !entry.bulkPricing && entry.tierPrices && entry.tierPrices.length > 0;

const isBulkCandidate = (entry) => entry.bulkPricing === true;

describe('mock price entries name only SKUs Liferay creates', () => {
  for (const [label, options] of [
    ['with variants', { generateSkuVariants: true }],
    ['without variants', { generateSkuVariants: false }],
    [
      'with bulk pricing',
      { generateBulkPricing: true, generateSkuVariants: true },
    ],
    [
      'with tier pricing',
      { generateSkuVariants: true, generateTierPricing: true },
    ],
  ]) {
    it(`prices every orderable SKU and nothing else, ${label}`, () => {
      const products = generate(options);

      expect(products.length).toBeGreaterThan(0);

      for (const product of products) {
        const orderable = skuCodesOf(product);

        expect(orderable.length).toBeGreaterThan(0);
        expect(
          product.priceEntries.map((e) => e.skuExternalReferenceCode)
        ).toEqual(orderable);
      }
    });
  }

  it('does not price the base SKU of a product whose options contribute SKUs', () => {
    for (const product of generate({ generateSkuVariants: true })) {
      const priced = product.priceEntries.map(
        (e) => e.skuExternalReferenceCode
      );

      expect(priced).not.toContain(product.baseSku);
      expect(priced).toHaveLength(product.skuVariants.length);
    }
  });

  it('prices the base SKU when there are no variants to replace it', () => {
    for (const product of generate({ generateSkuVariants: false })) {
      expect(
        product.priceEntries.map((e) => e.skuExternalReferenceCode)
      ).toEqual([product.baseSku]);
    }
  });
});

describe('mock price entries carry the product-level decoration', () => {
  it('gives every entry bulk tiers when bulk pricing is on', () => {
    for (const product of generate({
      generateBulkPricing: true,
      generateSkuVariants: true,
    })) {
      expect(product.priceEntries.every(isBulkCandidate)).toBe(true);

      for (const entry of product.priceEntries) {
        expect(entry.tierPrices.map((t) => t.minimumQuantity)).toEqual([
          10, 50,
        ]);
      }
    }
  });

  it('gives every entry tiers the tier step will select when tier pricing is on', () => {
    for (const product of generate({
      generateSkuVariants: true,
      generateTierPricing: true,
    })) {
      expect(product.priceEntries.every(isTierCandidate)).toBe(true);

      for (const entry of product.priceEntries) {
        expect(entry.tierPrices.map((t) => t.minimumQuantity)).toEqual([5, 20]);
      }
    }
  });

  it('leaves entries plain when neither option is on', () => {
    for (const product of generate({ generateSkuVariants: true })) {
      for (const entry of product.priceEntries) {
        expect(entry.bulkPricing).toBeUndefined();
        expect(entry.tierPrices).toBeUndefined();
      }
    }
  });

  it('gives every entry a promotional price when the product is on promotion', () => {
    const promoted = generate({ generateSkuVariants: true }).filter((product) =>
      product.priceEntries.some((e) => e.promoPrice !== null)
    );

    expect(promoted.length).toBeGreaterThan(0);

    for (const product of promoted) {
      expect(product.priceEntries.every((e) => e.promoPrice !== null)).toBe(
        true
      );
    }
  });

  /**
   * `addOrUpdateCommerceTierPriceEntry` resolves a tier by
   * `fetchByERC_C(erc, companyId)` - company-wide, not within the price entry -
   * and updates whatever it finds without reattaching it. Duplicate tier ERCs
   * across a product's variants therefore collapse to one row silently.
   */
  it('keys every tier and price entry ERC uniquely across the run', () => {
    const products = generate({
      generateSkuVariants: true,
      generateTierPricing: true,
    });

    const entryERCs = products.flatMap((p) =>
      p.priceEntries.map((e) => e.externalReferenceCode)
    );
    const tierERCs = products.flatMap((p) =>
      p.priceEntries.flatMap((e) =>
        e.tierPrices.map((t) => t.externalReferenceCode)
      )
    );

    expect(tierERCs.length).toBe(entryERCs.length * 2);
    expect(new Set(entryERCs).size).toBe(entryERCs.length);
    expect(new Set(tierERCs).size).toBe(tierERCs.length);
  });
});

describe('the tier pricing step files what the generator produced', () => {
  let productGenerator;
  let mockLiferay;

  // The sku step stamps the physical id onto each SKU it created; pricing.cjs
  // refuses any entry whose SKU has none, which is what used to happen to the
  // base entry.
  const withResolvedSkuIds = (products) =>
    products.map((product, index) => ({
      ...product,
      skuVariants: product.skuVariants.map((variant, position) => ({
        ...variant,
        id: 90000 + index * 100 + position,
      })),
    }));

  // Scoped to the standard list: an entry with a promotional price is also
  // filed into the promotions list, and that batch is a separate call.
  const submittedEntries = () =>
    mockLiferay.createPriceEntriesBatch.mock.calls
      .filter(([, , opts]) => opts.priceListId === 'base-pl')
      .flatMap(([, entries]) => entries);

  beforeEach(() => {
    vi.clearAllMocks();

    mockLiferay = {
      createPriceEntriesBatch: vi.fn().mockResolvedValue({ batchId: 'b-1' }),
      createPriceList: vi
        .fn()
        .mockImplementation((_config, data) =>
          Promise.resolve({ ...data, id: `created-${data.type}` })
        ),
      getPriceEntries: vi.fn().mockResolvedValue({ items: [] }),
      getPriceListByERC: vi.fn().mockResolvedValue(null),
      getPriceLists: vi.fn().mockResolvedValue({
        items: [
          {
            catalogBasePriceList: true,
            catalogId: CATALOG_ID,
            externalReferenceCode: null,
            id: 'base-pl',
            name: 'Master Base Price List',
            type: 'price-list',
          },
        ],
      }),
      patchPriceList: vi.fn().mockResolvedValue({}),
      rest: { _delete: vi.fn().mockResolvedValue({}) },
    };

    productGenerator = new ProductGenerator({
      liferay: mockLiferay,
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
      persistence: {
        createBatch: vi.fn().mockResolvedValue({}),
        getSession: vi.fn(),
        updateBatch: vi.fn().mockResolvedValue({}),
      },
      progress: { batchCompleted: vi.fn(), batchStarted: vi.fn() },
    });

    productGenerator.completeSyncStep = vi.fn().mockResolvedValue({});
    productGenerator.submitBatch = vi
      .fn()
      .mockImplementation(async (_s, _k, _e, _o, fn) => fn('batch-erc'));
  });

  const runStep = (step, options) => {
    const products = withResolvedSkuIds(generate(options));

    productGenerator.persistence.getSession.mockResolvedValue({
      correlationId: 'corr-1',
      session_id: 'sess-1',
      context: {
        config: { catalogId: String(CATALOG_ID), currencyCode: 'USD' },
        options: { generatePriceLists: true, ...options },
        productDataList: products,
      },
    });

    return step('sess-1').then(() => products);
  };

  it('sends a tiered entry for every variant, not one for a base SKU', async () => {
    const products = await runStep(
      productGenerator.steps[WORKFLOW_STEPS.GENERATE_TIER_PRICING],
      {
        generateSkuVariants: true,
        generateTierPricing: true,
      }
    );

    const expected = products.flatMap(skuCodesOf);
    const sent = submittedEntries();

    expect(sent.map((e) => e.skuExternalReferenceCode)).toEqual(expected);
    expect(sent.every((e) => e.hasTierPrice)).toBe(true);
    expect(sent.every((e) => e.tierPrices.length === 2)).toBe(true);
    expect(productGenerator.logger.warn).not.toHaveBeenCalled();
  });

  it('sends a bulk-priced entry for every variant', async () => {
    const products = await runStep(
      productGenerator.steps[WORKFLOW_STEPS.GENERATE_BULK_PRICING],
      {
        generateBulkPricing: true,
        generateSkuVariants: true,
      }
    );

    const sent = submittedEntries();

    expect(sent).toHaveLength(products.flatMap(skuCodesOf).length);
    expect(sent.every((e) => e.hasTierPrice)).toBe(true);
    expect(productGenerator.logger.warn).not.toHaveBeenCalled();
  });
});
