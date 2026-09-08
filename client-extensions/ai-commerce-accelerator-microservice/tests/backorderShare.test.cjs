const {
  BACKORDER_INVENTORY_CEILING,
  backorderRatio,
  inventoryBoundsFor,
  markBackorderShare,
} = require('../utils/backorderShare.cjs');
const { SELECTION_KEYS, selectShare } = require('../utils/shareSelection.cjs');

const productsOf = (count) =>
  Array.from({ length: count }, (_unused, index) => ({
    externalReferenceCode: `AICA-PRD-${String(index).padStart(4, '0')}`,
    name: { en_US: `Product ${index}` },
  }));

const enabled = (products) => products.filter((p) => p.allowBackOrder);

describe('backorderRatio', () => {
  it('is zero when the toggle is off, whatever the ratio says', () => {
    expect(
      backorderRatio({ backorderAssignmentRatio: 100, enableBackorders: false })
    ).toBe(0);
  });

  it('takes the ratio when the toggle is on', () => {
    expect(
      backorderRatio({ backorderAssignmentRatio: 50, enableBackorders: true })
    ).toBe(50);
  });

  it('respects an explicit zero with the toggle on', () => {
    expect(
      backorderRatio({ backorderAssignmentRatio: 0, enableBackorders: true })
    ).toBe(0);
  });

  it('is zero when the toggle is on and no ratio was configured', () => {
    // Unlike a media mode, the toggle carries no separate intent, so there is
    // nothing to infer a share from.
    expect(backorderRatio({ enableBackorders: true })).toBe(0);
    expect(backorderRatio({})).toBe(0);
  });
});

describe('markBackorderShare', () => {
  const options = { backorderAssignmentRatio: 50, enableBackorders: true };

  it('marks an exact share', () => {
    const marked = markBackorderShare(productsOf(50), options);

    expect(marked).toHaveLength(50);
    expect(enabled(marked)).toHaveLength(25);
  });

  it('marks none when the toggle is off', () => {
    const marked = markBackorderShare(productsOf(50), {
      ...options,
      enableBackorders: false,
    });

    expect(enabled(marked)).toHaveLength(0);
  });

  it('marks every product at 100%', () => {
    const marked = markBackorderShare(productsOf(10), {
      ...options,
      backorderAssignmentRatio: 100,
    });

    expect(enabled(marked)).toHaveLength(10);
  });

  it('leaves the rest of the product untouched', () => {
    const [product] = markBackorderShare(productsOf(1), {
      ...options,
      backorderAssignmentRatio: 100,
    });

    expect(product.name).toEqual({ en_US: 'Product 0' });
    expect(product.externalReferenceCode).toBe('AICA-PRD-0000');
  });

  // The share must be independent of the image, PDF and inventory shares, or
  // the same products carry every attribute while the rest sit inert (#729).
  it('draws independently of the inventory share', () => {
    const products = productsOf(50);
    const backorder = new Set(
      enabled(markBackorderShare(products, options)).map(
        (p) => p.externalReferenceCode
      )
    );
    const inventory = selectShare(products, 50, SELECTION_KEYS.INVENTORY).map(
      (p) => p.externalReferenceCode
    );

    const overlap = inventory.filter((erc) => backorder.has(erc)).length;
    const predicted = 50 * 0.5 * 0.5;

    // Correlated selection would put this at 25, not near 12.5.
    expect(overlap).toBeGreaterThan(predicted * 0.4);
    expect(overlap).toBeLessThan(predicted * 1.6);
  });

  it('keeps a product with no reference code out of the share', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const marked = markBackorderShare(
      [{ name: { en_US: 'Nameless' } }, ...productsOf(3)],
      { ...options, backorderAssignmentRatio: 100 },
      { logger }
    );

    expect(marked[0].allowBackOrder).toBe(false);
  });

  it('reports how many it marked', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };

    markBackorderShare(productsOf(10), options, { logger });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Backorders enabled on 5 of 10 products')
    );
  });

  it('survives an empty or missing list', () => {
    expect(markBackorderShare([], options)).toEqual([]);
    expect(markBackorderShare(undefined, options)).toEqual([]);
  });
});

describe('inventoryBoundsFor', () => {
  const options = { inventoryMax: 1000, inventoryMin: 0 };

  it('leaves an ordinary product on the configured range', () => {
    expect(inventoryBoundsFor({ allowBackOrder: false }, options)).toEqual({
      max: 1000,
      min: 0,
    });
  });

  // A backorder-enabled product holding a thousand units never demonstrates a
  // backorder: the flag would be set correctly and nothing would follow.
  it('caps a backorder product well below the configured maximum', () => {
    const { max } = inventoryBoundsFor({ allowBackOrder: true }, options);

    expect(max).toBe(BACKORDER_INVENTORY_CEILING);
    expect(max).toBeLessThan(options.inventoryMax);
  });

  it('puts the first backorder product at zero, so the state is always visible', () => {
    expect(
      inventoryBoundsFor({ allowBackOrder: true }, options, {
        isFirstBackorder: true,
      })
    ).toEqual({ max: 0, min: 0 });
  });

  it('does not raise stock above a configured maximum lower than the ceiling', () => {
    // An operator asking for 0..2 gets 0..2, not 0..5.
    const { max, min } = inventoryBoundsFor(
      { allowBackOrder: true },
      { inventoryMax: 2, inventoryMin: 1 }
    );

    expect(max).toBe(2);
    expect(min).toBe(1);
  });

  it('falls back to sane bounds when none are configured', () => {
    expect(inventoryBoundsFor({ allowBackOrder: false }, {})).toEqual({
      max: 100,
      min: 10,
    });
  });

  it('treats a product with no flag as ordinary', () => {
    expect(inventoryBoundsFor({}, options).max).toBe(1000);
    expect(inventoryBoundsFor(undefined, options).max).toBe(1000);
  });
});
