const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const { coverPriceEntries } = require('../utils/priceEntryCoverage.cjs');

/**
 * The AI path's half of the price entry invariant.
 *
 * #789 fixed the demo path in the generator itself; the model was left free to
 * return one entry against `baseSku` with the tiers on it. Liferay creates no
 * base SKU for a product with SKU-contributing options, so `pricing.cjs`
 * refused that entry - 25 `Skipping price entry` warnings in one live run -
 * and the tiers went with it, because the tier step selects candidates by
 * `tierPrices` being non-empty. The synthesis that was meant to rescue the
 * variants hard-coded `tierPrices: []`, so it could not. See #787.
 */

const CATALOG_ID = 987;

const baseEntry = () => ({
  bulkPricing: false,
  discountDiscovery: false,
  externalReferenceCode: 'MODEL-CHOSE-THIS',
  price: 100,
  priceListExternalReferenceCode: 'AICA-PL-GENERAL',
  promoPrice: 80,
  skuExternalReferenceCode: 'PANNIER-001',
  tierPrices: [
    { externalReferenceCode: 'TP-A', minimumQuantity: 5, price: 95 },
    { externalReferenceCode: 'TP-B', minimumQuantity: 20, price: 90 },
  ],
});

// The shape generate-product-data hands to the pricing steps: a base SKU the
// options make unorderable, two variants, and the model's single base entry.
const aiProduct = (overrides = {}) => ({
  baseSku: 'PANNIER-001',
  externalReferenceCode: 'AICA-PRODUCT-1',
  priceEntries: [baseEntry()],
  productOptions: [
    {
      fieldType: 'select',
      name: 'Color',
      productOptionValues: ['Black', 'Silver'],
      skuContributor: true,
    },
  ],
  skus: [
    { externalReferenceCode: 'PANNIER-001', price: 100, sku: 'PANNIER-001' },
  ],
  skuVariants: [
    {
      externalReferenceCode: 'PANNIER-001-BLK',
      id: 9001,
      priceModifier: 0,
      sku: 'PANNIER-001-BLK',
    },
    {
      externalReferenceCode: 'PANNIER-001-SLV',
      id: 9002,
      priceModifier: 0.2,
      sku: 'PANNIER-001-SLV',
    },
  ],
  ...overrides,
});

const codesOf = (result) =>
  result.priceEntries.map((entry) => entry.skuExternalReferenceCode);

describe('price entries name only the SKUs Liferay will create', () => {
  it('replaces a lone base entry with one entry per variant', () => {
    const result = coverPriceEntries(aiProduct());

    expect(codesOf(result)).toEqual(['PANNIER-001-BLK', 'PANNIER-001-SLV']);
    expect(result.dropped).toEqual(['PANNIER-001']);
    expect(result.synthesised).toEqual(['PANNIER-001-BLK', 'PANNIER-001-SLV']);
  });

  it('keeps the base entry when no option contributes a SKU', () => {
    const product = aiProduct({
      productOptions: [
        {
          fieldType: 'text',
          name: 'Engraving',
          productOptionValues: [],
          skuContributor: false,
        },
      ],
      skuVariants: [],
    });
    const result = coverPriceEntries(product);

    expect(codesOf(result)).toEqual(['PANNIER-001']);
    expect(result.dropped).toEqual([]);
    // Returned as it arrived, so a compliant response is not rewritten.
    expect(result.priceEntries[0]).toBe(product.priceEntries[0]);
  });

  it('leaves a fully covered response untouched', () => {
    const product = aiProduct({
      priceEntries: [
        { ...baseEntry(), skuExternalReferenceCode: 'PANNIER-001-BLK' },
        { ...baseEntry(), skuExternalReferenceCode: 'PANNIER-001-SLV' },
      ],
    });
    const result = coverPriceEntries(product);

    expect(result.priceEntries).toEqual(product.priceEntries);
    expect(result.dropped).toEqual([]);
    expect(result.synthesised).toEqual([]);
  });

  it('drops a second entry for a SKU that is already priced', () => {
    const result = coverPriceEntries(
      aiProduct({
        priceEntries: [
          { ...baseEntry(), skuExternalReferenceCode: 'PANNIER-001-BLK' },
          {
            ...baseEntry(),
            price: 7,
            skuExternalReferenceCode: 'PANNIER-001-BLK',
          },
          { ...baseEntry(), skuExternalReferenceCode: 'PANNIER-001-SLV' },
        ],
      })
    );

    expect(codesOf(result)).toEqual(['PANNIER-001-BLK', 'PANNIER-001-SLV']);
    expect(result.priceEntries[0].price).toBe(100);
    expect(result.dropped).toEqual(['PANNIER-001-BLK']);
  });

  it('prices nothing for a product whose variants never arrived', () => {
    const result = coverPriceEntries(aiProduct({ skuVariants: [] }));

    expect(result.priceEntries).toEqual([]);
    expect(result.dropped).toEqual(['PANNIER-001']);
  });

  // The model returns `skuVariants` and `skuContributor` whether or not
  // variants were asked for, and `products.cjs` omits the base SKU only when
  // they were. So the run with them off is the one run where a base entry is
  // the entry to keep, and dropping it would leave the product unpriced.
  it('keeps the base entry when the run creates no variants', () => {
    const product = aiProduct();
    const result = coverPriceEntries(product, { variants: false });

    expect(codesOf(result)).toEqual(['PANNIER-001']);
    expect(result.dropped).toEqual([]);
    expect(result.synthesised).toEqual([]);
    expect(result.priceEntries[0]).toBe(product.priceEntries[0]);
  });

  it('survives a product with no price entries at all', () => {
    const result = coverPriceEntries(aiProduct({ priceEntries: undefined }));

    expect(result.priceEntries).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.synthesised).toEqual([]);
  });
});

describe('a derived entry carries the whole of the base entry decoration', () => {
  it('gives every variant the base entry tiers', () => {
    const result = coverPriceEntries(aiProduct());

    for (const entry of result.priceEntries) {
      expect(entry.tierPrices.map((tier) => tier.minimumQuantity)).toEqual([
        5, 20,
      ]);
    }
  });

  /**
   * `addOrUpdateCommerceTierPriceEntry` resolves a tier by
   * `fetchByERC_C(erc, companyId)` - company-wide, not within the price entry -
   * so two variants sharing one code leave a single tier row and report no
   * error.
   */
  it('keys every entry and tier code to its own SKU', () => {
    const result = coverPriceEntries(aiProduct());

    const entryERCs = result.priceEntries.map(
      (entry) => entry.externalReferenceCode
    );
    const tierERCs = result.priceEntries.flatMap((entry) =>
      entry.tierPrices.map((tier) => tier.externalReferenceCode)
    );

    expect(new Set(entryERCs).size).toBe(2);
    expect(entryERCs).not.toContain('MODEL-CHOSE-THIS');
    expect(new Set(tierERCs).size).toBe(4);
    expect(tierERCs).not.toContain('TP-A');
  });

  it('scales the price, the promotional price and the tiers by the modifier', () => {
    const [black, silver] = coverPriceEntries(aiProduct()).priceEntries;

    expect(black.price).toBe(100);
    expect(black.promoPrice).toBe(80);
    expect(black.tierPrices.map((tier) => tier.price)).toEqual([95, 90]);

    expect(silver.price).toBe(120);
    expect(silver.promoPrice).toBe(96);
    expect(silver.tierPrices.map((tier) => tier.price)).toEqual([114, 108]);
  });

  it('carries no promotional price when the base entry had none', () => {
    const result = coverPriceEntries(
      aiProduct({
        priceEntries: [{ ...baseEntry(), promoPrice: null }],
      })
    );

    for (const entry of result.priceEntries) {
      expect(entry.promoPrice).toBeUndefined();
    }
  });

  it('never derives a price of zero, which Liferay rejects', () => {
    const result = coverPriceEntries(
      aiProduct({
        priceEntries: [{ ...baseEntry(), price: 0, tierPrices: [] }],
        skuVariants: [
          {
            externalReferenceCode: 'PANNIER-001-BLK',
            priceModifier: -1,
            sku: 'PANNIER-001-BLK',
          },
        ],
      })
    );

    expect(result.priceEntries[0].price).toBe(0.01);
  });

  /**
   * `pricingSteps` adds create-bulk-pricing and create-tier-pricing only when
   * their option is ticked, and the price-lists step selects plain entries
   * only. A volunteered tier would therefore be filed by no step that runs and
   * take the product's price with it.
   */
  it('drops a decoration no step in the run can file', () => {
    const result = coverPriceEntries(aiProduct(), { tiers: false });

    expect(result.priceEntries).toHaveLength(2);

    for (const entry of result.priceEntries) {
      expect(entry.tierPrices).toBeUndefined();
      expect(entry.bulkPricing).toBeUndefined();
      expect(entry.price).toBeGreaterThan(0);
    }
  });

  /**
   * The rescue path exists precisely because the model under-delivers, so the
   * only entry it returned is often a variant's. Applying the new variant's
   * modifier to an already-discounted price would compound the two and seed
   * the whole product below its base price.
   */
  it('does not compound the modifier when the template is itself a variant', () => {
    const result = coverPriceEntries(
      aiProduct({
        priceEntries: [
          {
            ...baseEntry(),
            price: 120,
            promoPrice: null,
            skuExternalReferenceCode: 'PANNIER-001-SLV',
            tierPrices: [],
          },
        ],
      })
    );

    const black = result.priceEntries.find(
      (entry) => entry.skuExternalReferenceCode === 'PANNIER-001-BLK'
    );

    expect(black.price).toBe(100);
  });

  it('prefers a SKU that states its own price', () => {
    const result = coverPriceEntries(
      aiProduct({
        productOptions: [],
        priceEntries: [
          { ...baseEntry(), skuExternalReferenceCode: 'PANNIER-001-BLK' },
        ],
        skus: [
          {
            externalReferenceCode: 'PANNIER-001',
            price: 250,
            sku: 'PANNIER-001',
          },
        ],
      })
    );

    const base = result.priceEntries.find(
      (entry) => entry.skuExternalReferenceCode === 'PANNIER-001'
    );

    expect(base.price).toBe(250);
  });
});

describe('the pricing step files tiers for every variant of an AI product', () => {
  let productGenerator;
  let mockLiferay;

  const submittedEntries = () =>
    mockLiferay.createPriceEntry.mock.calls
      .filter(([, priceListKey]) => priceListKey === 'base-pl')
      .map(([, , entry]) => entry);

  beforeEach(() => {
    vi.clearAllMocks();

    mockLiferay = {
      createPriceEntriesBatch: vi.fn().mockResolvedValue({ batchId: 'b-1' }),
      createPriceEntry: vi.fn().mockResolvedValue({ id: 'pe-1' }),
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
      progress: {
        batchCompleted: vi.fn(),
        batchStarted: vi.fn(),
        stepWarning: vi.fn(),
      },
    });

    productGenerator.completeSyncStep = vi.fn().mockResolvedValue({});
    productGenerator.submitBatch = vi
      .fn()
      .mockImplementation(async (_s, _k, _e, _o, fn) => {
        await fn('batch-erc');
        // The real submitBatch hands back the row it wrote, which is how a
        // step corrects a completed batch's processed count (#891).
        return { batchERC: 'batch-erc', batchId: 'b-1' };
      });
  });

  const runTierStep = (products) => {
    productGenerator.persistence.getSession.mockResolvedValue({
      correlationId: 'corr-1',
      session_id: 'sess-1',
      context: {
        config: { catalogId: String(CATALOG_ID), currencyCode: 'USD' },
        options: { generatePriceLists: true, generateTierPricing: true },
        productDataList: products,
      },
    });

    return productGenerator.steps[WORKFLOW_STEPS.GENERATE_TIER_PRICING](
      'sess-1'
    );
  };

  it('sends a tiered entry per variant and no base entry to skip', async () => {
    await runTierStep([aiProduct()]);

    const sent = submittedEntries();

    expect(sent.map((entry) => entry.skuExternalReferenceCode)).toEqual([
      'PANNIER-001-BLK',
      'PANNIER-001-SLV',
    ]);
    expect(sent.map((entry) => entry.skuId)).toEqual([9001, 9002]);
    expect(sent.every((entry) => entry.hasTierPrice)).toBe(true);
    expect(sent.every((entry) => entry.tierPrices.length === 2)).toBe(true);

    const tierERCs = sent.flatMap((entry) =>
      entry.tierPrices.map((tier) => tier.externalReferenceCode)
    );

    expect(new Set(tierERCs).size).toBe(4);
    expect(productGenerator.logger.warn).not.toHaveBeenCalled();
  });

  it('reports what it corrected', async () => {
    await runTierStep([aiProduct()]);

    expect(productGenerator.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Price entry coverage'),
      expect.objectContaining({ sessionId: 'sess-1' })
    );
  });
});
