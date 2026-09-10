const {
  hasSkuContributingOptions,
  orderableSkus,
  orderableSkusFor,
} = require('../utils/orderableSkus.cjs');

const withOptions = {
  externalReferenceCode: 'AICA-PRD-0001',
  options: [
    {
      name: 'Color',
      productOptionValues: ['Red', 'Blue'],
      skuContributor: true,
    },
    { name: 'Size', productOptionValues: ['S', 'M'], skuContributor: true },
  ],
  skus: [{ sku: 'BASE-1' }],
  skuVariants: [
    { options: { Color: 'Red', Size: 'S' }, sku: 'BASE-1-RED-S' },
    { options: { Color: 'Blue', Size: 'M' }, sku: 'BASE-1-BLUE-M' },
  ],
};

const withoutOptions = {
  externalReferenceCode: 'AICA-PRD-0002',
  options: [{ name: 'Note', fieldType: 'text', skuContributor: false }],
  skus: [{ sku: 'BASE-2' }],
  skuVariants: [],
};

const codes = (skus) => skus.map((s) => s.sku);

describe('hasSkuContributingOptions', () => {
  it('is true when any option contributes to the SKU', () => {
    expect(hasSkuContributingOptions(withOptions)).toBe(true);
  });

  it('is false when none do', () => {
    expect(hasSkuContributingOptions(withoutOptions)).toBe(false);
  });

  it('reads productOptions as well as options, since the link step sets both', () => {
    expect(
      hasSkuContributingOptions({ productOptions: withOptions.options })
    ).toBe(true);
  });

  it('is false for a product with no options at all', () => {
    expect(hasSkuContributingOptions({})).toBe(false);
    expect(hasSkuContributingOptions(undefined)).toBe(false);
  });
});

describe('orderableSkusFor', () => {
  // Liferay activates a SKU only with a value for every SKU-contributing
  // option, and products.cjs does not create the base SKU for such a product -
  // so naming it in an order references something that does not exist (#747).
  it('uses the variants, not the base SKU, when options contribute', () => {
    expect(codes(orderableSkusFor(withOptions))).toEqual([
      'BASE-1-RED-S',
      'BASE-1-BLUE-M',
    ]);
  });

  it('uses the base SKU when no option contributes', () => {
    expect(codes(orderableSkusFor(withoutOptions))).toEqual(['BASE-2']);
  });

  it('returns nothing rather than falling back to an uncreated base SKU', () => {
    // A fallback here would put the run back where it started: an order naming
    // a SKU Liferay never created.
    const noVariants = { ...withOptions, skuVariants: [] };

    expect(orderableSkusFor(noVariants)).toEqual([]);
  });

  it('includes both when a product has variants and no contributing options', () => {
    const both = {
      ...withoutOptions,
      skuVariants: [{ sku: 'BASE-2-EXTRA' }],
    };

    expect(codes(orderableSkusFor(both))).toEqual(['BASE-2', 'BASE-2-EXTRA']);
  });

  it('skips a SKU that cannot be named', () => {
    const nameless = {
      ...withoutOptions,
      skus: [{ price: 10 }, { sku: 'BASE-2' }],
    };

    expect(codes(orderableSkusFor(nameless))).toEqual(['BASE-2']);
  });

  it('accepts a SKU identified only by reference code', () => {
    const ercOnly = {
      ...withoutOptions,
      skus: [{ externalReferenceCode: 'ERC-ONLY' }],
    };

    expect(orderableSkusFor(ercOnly)).toHaveLength(1);
  });

  // purchasable is a Liferay flag the generator sets true on everything it
  // creates. Filtering on it would silently drop SKUs the moment a generator
  // stopped setting it - the failure mode this file exists to prevent.
  it('does not filter on purchasable', () => {
    const unmarked = {
      ...withoutOptions,
      skus: [{ purchasable: false, sku: 'BASE-2' }],
    };

    expect(codes(orderableSkusFor(unmarked))).toEqual(['BASE-2']);
  });

  it('survives a product with nothing on it', () => {
    expect(orderableSkusFor({})).toEqual([]);
    expect(orderableSkusFor(undefined)).toEqual([]);
  });
});

describe('orderableSkus', () => {
  it('collects across products, mixing both kinds', () => {
    expect(codes(orderableSkus([withOptions, withoutOptions]))).toEqual([
      'BASE-1-RED-S',
      'BASE-1-BLUE-M',
      'BASE-2',
    ]);
  });

  it('reports what it found', () => {
    const logger = { debug: vi.fn(), info: vi.fn() };

    orderableSkus([withOptions, withoutOptions], { logger });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('3 orderable SKU(s) across 2 product(s)')
    );
    // The stranded base SKUs are worth a line: they exist in the run's data
    // and not in Liferay, which is confusing without an explanation.
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('base SKU that Liferay does not create')
    );
  });

  it('survives an empty or missing list', () => {
    expect(orderableSkus([])).toEqual([]);
    expect(orderableSkus(undefined)).toEqual([]);
  });
});

// The product cannot say which run it is in. `prompts/product.md` asks for
// `skuVariants` and `skuContributor` unconditionally and `generation.cjs` keeps
// what the model returns, so a product on a `generateSkuVariants: false` run
// looks exactly like a variant product - while `products.cjs` created its base
// SKU and `skus.cjs` created no variants at all. See #810, and #787 for the
// same defect on the pricing path.
describe('a run that is not creating variants', () => {
  it('orders the base SKU, the only one Liferay created', () => {
    expect(codes(orderableSkusFor(withOptions, { variants: false }))).toEqual([
      'BASE-1',
    ]);
  });

  it('never offers a variant Liferay was never asked to create', () => {
    const names = codes(orderableSkus([withOptions], { variants: false }));

    expect(names).not.toContain('BASE-1-RED-S');
    expect(names).not.toContain('BASE-1-BLUE-M');
  });

  it('leaves a product with nothing contributing exactly as it was', () => {
    expect(
      codes(orderableSkusFor(withoutOptions, { variants: false }))
    ).toEqual(['BASE-2']);
  });

  it('still returns nothing when there is no base SKU to order', () => {
    // No fallback to the variants: a run that created no base SKU created
    // nothing at all for this product, and an order naming a variant would
    // fail exactly as one naming an uncreated base SKU does.
    const baseless = { ...withOptions, skus: [] };

    expect(orderableSkusFor(baseless, { variants: false })).toEqual([]);
  });

  it('assumes variants when the caller does not say, so #747 stands', () => {
    expect(codes(orderableSkusFor(withOptions))).toEqual([
      'BASE-1-RED-S',
      'BASE-1-BLUE-M',
    ]);
    expect(codes(orderableSkus([withOptions]))).toEqual([
      'BASE-1-RED-S',
      'BASE-1-BLUE-M',
    ]);
  });

  it('does not call the base SKU stranded when the run kept it', () => {
    const logger = { debug: vi.fn(), info: vi.fn() };

    orderableSkus([withOptions], { logger, variants: false });

    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining('base SKU that Liferay does not create')
    );
  });
});

describe('the order step merges context products by the same rule', () => {
  const { orderableSkus } = require('../utils/orderableSkus.cjs');

  // `cp.skus || cp.skuVariants` took the base SKU whenever one existed,
  // because a non-empty array short-circuits the ||. Liferay creates no base
  // SKU for a product with SKU-contributing options, so orders named one that
  // did not exist and create-orders died with CPInstanceSkuException. The pool
  // filter could not save it: the merge put the base SKU on an object that
  // carried no option data, so nothing downstream could tell it should go.
  const productWithVariants = {
    externalReferenceCode: 'AICA-PRD-1',
    productOptions: [{ name: 'Color', skuContributor: true }],
    skus: [{ sku: 'SKU-ELE-037' }],
    skuVariants: [{ sku: 'SKU-ELE-037-RED' }, { sku: 'SKU-ELE-037-BLUE' }],
  };

  it('never offers the base SKU of a product whose options make variants', () => {
    const merged = orderableSkus([productWithVariants]);
    const names = merged.map((s) => s.sku);

    expect(names).not.toContain('SKU-ELE-037');
    expect(names).toEqual(['SKU-ELE-037-RED', 'SKU-ELE-037-BLUE']);
  });

  it('is not fooled by the base array simply being non-empty', () => {
    // The shape the old `||` expression got wrong: both arrays populated.
    expect(productWithVariants.skus.length).toBeGreaterThan(0);
    expect(orderableSkus([productWithVariants])).toHaveLength(2);
  });

  it('still offers the base SKU when nothing contributes variants', () => {
    const plain = {
      externalReferenceCode: 'AICA-PRD-2',
      productOptions: [{ name: 'Gift wrap', skuContributor: false }],
      skus: [{ sku: 'SKU-ELE-100' }],
      skuVariants: [],
    };

    expect(orderableSkus([plain]).map((s) => s.sku)).toEqual(['SKU-ELE-100']);
  });
});
