const MockDataGenerator = require('../generators/mockDataGenerator.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const {
  VARIANT_BUDGET,
  coverProductOptionValues,
} = require('../utils/optionValueCoverage.cjs');
const { toOptionValues } = require('../utils/optionValues.cjs');
const {
  LINKED_OPTION_ID,
  LINKED_OPTION_VALUES,
  LINKED_OPTION_VALUE_ID,
  UNRESOLVED,
  resolveSkuOptionLink,
} = require('../utils/productOptionLinks.cjs');
const { sanitizeForERC } = require('../utils/misc.cjs');

/**
 * The 2026-09-08 live run shipped 22 SKUs Liferay marked inactive because a
 * variant named a value its option never declared, and left declared values
 * with nothing to sell behind them. Both directions of that are covered here,
 * and both are closed by covering rather than by deleting. See #754.
 */
describe('option value coverage', () => {
  const logger = () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  });

  const product = (overrides = {}) => ({
    externalReferenceCode: 'SOLARA-001-123',
    baseSku: 'SOLARA-001',
    skus: [{ sku: 'SOLARA-001', price: 100, cost: 60 }],
    options: [
      {
        name: 'Color',
        fieldType: 'select',
        skuContributor: true,
        productOptionValues: ['Black', 'Silver'],
      },
      {
        name: 'Size',
        fieldType: 'select',
        skuContributor: true,
        productOptionValues: ['S', 'L'],
      },
    ],
    skuVariants: [
      {
        sku: 'SOLARA-001-BLK-S',
        options: { Color: 'Black', Size: 'S' },
        price: 100,
        priceModifier: 0,
        inStock: true,
      },
      {
        sku: 'SOLARA-001-BLK-L',
        options: { Color: 'Black', Size: 'L' },
        price: 110,
        priceModifier: 0.1,
        inStock: true,
      },
    ],
    ...overrides,
  });

  // More declared colours than the prompt's variant budget allows for, so
  // covering every one of them cannot fit inside it.
  const overBudgetProduct = () => {
    const source = product();
    source.options[0].productOptionValues = [
      'Black',
      ...Array.from(
        { length: VARIANT_BUDGET + 1 },
        (_value, index) => `Colour ${index}`
      ),
    ];
    return source;
  };

  const valuesFor = (result, name) =>
    result.options.find((option) => option.name === name).productOptionValues;

  const selectionsFor = (result, name) =>
    result.skuVariants.map((variant) =>
      new Map(Object.entries(variant.options)).get(name)
    );

  describe('a variant naming a value the option does not declare', () => {
    it('declares the value rather than dropping the link', () => {
      const source = product();
      source.skuVariants[1].options.Color = 'Midnight Blue';

      const result = coverProductOptionValues(source);

      expect(valuesFor(result, 'Color')).toContain('Midnight Blue');
      expect(result.addedValues).toContain('Color=Midnight Blue');
    });

    it('makes the link resolvable, which is what activates the SKU', () => {
      const source = product();
      source.skuVariants[1].options.Color = 'Midnight Blue';

      const covered = coverProductOptionValues(source);

      // Stands in for link-product-options: it sends the declared values and
      // Liferay answers with a relationship id per value.
      const linkedOptions = covered.options.map((option, index) => ({
        ...option,
        [LINKED_OPTION_ID]: 500 + index,
        [LINKED_OPTION_VALUES]: toOptionValues(
          option.productOptionValues,
          sanitizeForERC
        ).map((value, position) => ({
          ...value,
          [LINKED_OPTION_VALUE_ID]: 600 + index * 10 + position,
        })),
      }));

      const link = resolveSkuOptionLink(
        linkedOptions,
        'Color',
        'Midnight Blue'
      );

      expect(link.reason).toBeUndefined();
      expect(link.optionValueId).toBeGreaterThan(0);
    });

    it('reports what an unreconciled product would have lost', () => {
      const link = resolveSkuOptionLink(
        [
          {
            name: 'Color',
            [LINKED_OPTION_ID]: 500,
            [LINKED_OPTION_VALUES]: [
              { [LINKED_OPTION_VALUE_ID]: 601, name: { en_US: 'Black' } },
            ],
          },
        ],
        'Color',
        'Midnight Blue'
      );

      expect(link.reason).toBe(UNRESOLVED.VALUE_NOT_MATCHED);
    });

    it('leaves numeric and text options entirely alone', () => {
      const source = product({
        options: [
          {
            name: 'Length',
            fieldType: 'numeric',
            skuContributor: true,
            productOptionValues: [],
          },
          {
            name: 'Engraving',
            fieldType: 'text',
            skuContributor: false,
            productOptionValues: [],
          },
        ],
        skuVariants: [
          {
            sku: 'SOLARA-001-30',
            options: { Length: '30', Engraving: 'Initials' },
            priceModifier: 0,
            inStock: true,
          },
        ],
      });

      const result = coverProductOptionValues(source);

      expect(valuesFor(result, 'Length')).toEqual([]);
      expect(valuesFor(result, 'Engraving')).toEqual([]);
      expect(result.skuVariants).toHaveLength(1);
      expect(result.options[0]).toBe(source.options[0]);
    });
  });

  describe('a declared value no variant uses', () => {
    it('builds the missing variant instead of deleting the value', () => {
      const result = coverProductOptionValues(product());

      expect(valuesFor(result, 'Color')).toEqual(['Black', 'Silver']);
      expect(selectionsFor(result, 'Color')).toContain('Silver');
      expect(result.synthesisedVariants).toHaveLength(1);
    });

    it('substitutes the one value into a sibling, leaving the rest', () => {
      const result = coverProductOptionValues(product());
      const built = result.skuVariants.at(-1);

      expect(built.options).toEqual({ Color: 'Silver', Size: 'S' });
      expect(built.sku).toBe('SOLARA-001-SILVER-S');
      expect(built.externalReferenceCode).toBe(built.sku);
    });

    it('inherits price and stock from the sibling it came from', () => {
      const result = coverProductOptionValues(product());
      const built = result.skuVariants.at(-1);

      // Only what the sibling carried. create-skus falls back to the base SKU
      // for the rest, and the pricing step derives a missing price entry from
      // priceModifier, so inventing values here would override both.
      expect(built.price).toBe(100);
      expect(built.priceModifier).toBe(0);
      expect(built.inStock).toBe(true);
      expect(built.cost).toBeUndefined();
    });

    it('covers every option, not only the first', () => {
      const source = product();
      source.options[1].productOptionValues = ['S', 'L', 'XL'];

      const result = coverProductOptionValues(source);

      expect(selectionsFor(result, 'Color')).toContain('Silver');
      expect(selectionsFor(result, 'Size')).toContain('XL');
    });

    it('leaves a non-contributing option to be offered on every SKU', () => {
      const source = product();
      source.options.push({
        name: 'Warranty',
        fieldType: 'select',
        skuContributor: false,
        productOptionValues: ['1 Year', '3 Year'],
      });

      const result = coverProductOptionValues(source);

      expect(valuesFor(result, 'Warranty')).toEqual(['1 Year', '3 Year']);
      expect(result.synthesisedVariants).toHaveLength(1);
    });

    it('never reuses a SKU code that is already taken', () => {
      const source = product();
      source.skuVariants.push({
        sku: 'SOLARA-001-SILVER-S',
        options: { Color: 'Black', Size: 'S' },
        priceModifier: 0,
        inStock: true,
      });

      const result = coverProductOptionValues(source);
      const codes = result.skuVariants.map((variant) => variant.sku);

      expect(new Set(codes).size).toBe(codes.length);
    });

    it('builds a first variant for a product the model gave none', () => {
      const result = coverProductOptionValues(product({ skuVariants: [] }));

      expect(result.skuVariants).toHaveLength(3);
      expect(result.skuVariants[0].sku).toBe('SOLARA-001-BLACK-S');
      expect(result.skuVariants[0].price).toBe(100);
      expect(selectionsFor(result, 'Color')).toContain('Silver');
      expect(selectionsFor(result, 'Size')).toContain('L');
    });
  });

  describe('when covering will not fit the prompt budget', () => {
    it('names the product rather than resolving it silently', () => {
      const log = logger();
      const source = overBudgetProduct();

      const result = coverProductOptionValues(source, { logger: log });

      expect(result.overBudget).toBe(true);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('SOLARA-001-123'),
        expect.anything()
      );
    });

    it('still covers the values, because dropping one is the defect', () => {
      const source = overBudgetProduct();

      const result = coverProductOptionValues(source, { logger: logger() });

      expect(result.skuVariants.length).toBeGreaterThan(VARIANT_BUDGET);
      expect(valuesFor(result, 'Color')).toHaveLength(VARIANT_BUDGET + 2);
      expect(selectionsFor(result, 'Color')).toEqual(
        expect.arrayContaining(source.options[0].productOptionValues)
      );
    });
  });

  /**
   * mockDataGenerator derives its variants from the declared values (#751), so
   * it already satisfies the invariant. A change here that altered its output
   * would mean the rule and the generator disagree.
   */
  it('leaves the mock generator untouched', () => {
    const mock = new MockDataGenerator({ liferay: {}, logger: logger() });
    const products = mock.generateProductData(
      'Electronics',
      3,
      { catalogId: 987 },
      null,
      ['en-US'],
      { generatePriceLists: true, generateSkuVariants: true }
    );

    for (const generated of products) {
      const result = coverProductOptionValues(generated);

      expect(result.addedValues).toEqual([]);
      expect(result.synthesisedVariants).toEqual([]);
      expect(result.options).toEqual(generated.options);
      expect(result.skuVariants).toEqual(generated.skuVariants);
    }
  });
});

/**
 * The seam matters as much as the function. ensure-options registers the global
 * CPOption values from the same array, and it runs several steps before
 * link-product-options, so a value declared any later reaches linking with no
 * global definition behind it.
 */
describe('the generate-product-data step', () => {
  let generated;
  let generator;
  let session;

  const runStep = async (options) => {
    session = {
      session_id: 'sess-1',
      correlationId: 'corr-1',
      context: { config: { catalogId: '123' }, options },
    };

    const persistence = {
      createBatch: vi.fn().mockResolvedValue({ id: 'batch-1' }),
      getSession: vi.fn().mockResolvedValue(session),
      updateSessionContext: vi.fn().mockImplementation((_id, patch) => {
        Object.assign(session.context, patch);
      }),
    };

    generator = new ProductGenerator({
      generation: { generateData: vi.fn().mockResolvedValue([generated]) },
      liferay: {},
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
      persistence,
      progress: { batchCompleted: vi.fn(), batchStarted: vi.fn() },
    });

    generator.completeSyncStep = vi.fn().mockResolvedValue({});

    await generator.steps[WORKFLOW_STEPS.GENERATE_PRODUCT_DATA]('sess-1');

    return session.context.productDataList[0];
  };

  beforeEach(() => {
    generated = {
      baseSku: 'SOLARA-002',
      externalReferenceCode: 'SOLARA-002-1',
      name: { en_US: 'Solara Pack' },
      options: [
        {
          fieldType: 'select',
          name: 'Color',
          productOptionValues: ['Black', 'Silver'],
          skuContributor: true,
        },
      ],
      skus: [{ price: 100, sku: 'SOLARA-002' }],
      skuVariants: [
        {
          inStock: true,
          options: { Color: 'Black' },
          priceModifier: 0,
          sku: 'SOLARA-002-BLK',
        },
      ],
    };
  });

  it('covers the product before any of the option steps see it', async () => {
    const product = await runStep({
      generateSkuVariants: true,
      productCount: 1,
    });

    expect(product.skuVariants).toHaveLength(2);
    expect(product.skuVariants[1].options).toEqual({ Color: 'Silver' });
  });

  it('gives a synthesised variant the ERC the rest of the run resolves by', async () => {
    const product = await runStep({
      generateSkuVariants: true,
      productCount: 1,
    });

    for (const variant of product.skuVariants) {
      expect(variant.externalReferenceCode).toBe(variant.sku);
    }
  });

  it('does nothing when the run is not creating variants at all', async () => {
    const product = await runStep({
      generateSkuVariants: false,
      productCount: 1,
    });

    expect(product.skuVariants).toHaveLength(1);
    expect(product.options[0].productOptionValues).toEqual(['Black', 'Silver']);
  });
});
