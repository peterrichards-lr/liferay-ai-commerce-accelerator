const {
  SELECTION_KEYS,
  clampRatio,
  selectShare,
  shareCount,
  toPercentage,
} = require('../utils/shareSelection.cjs');

const productsOf = (count) =>
  Array.from({ length: count }, (_unused, index) => ({
    externalReferenceCode: `AICA-PRD-${String(index).padStart(4, '0')}`,
  }));

const ercs = (items) => items.map((item) => item.externalReferenceCode);
const setOf = (items) => new Set(ercs(items));
const overlap = (a, b) => ercs(a).filter((erc) => setOf(b).has(erc)).length;

describe('shareCount', () => {
  it('gives an exact count rather than a per-item probability', () => {
    expect(shareCount(50, 0)).toBe(0);
    expect(shareCount(50, 50)).toBe(25);
    expect(shareCount(50, 100)).toBe(50);
    expect(shareCount(10, 70)).toBe(7);
  });

  it('clamps out-of-range ratios instead of returning nothing', () => {
    // `selectProductsForImages` used to return [] above 100, so a 150 produced
    // no images at all rather than all of them.
    expect(shareCount(50, 150)).toBe(50);
    expect(shareCount(50, -10)).toBe(0);
  });

  it('handles an empty or nonsense population', () => {
    expect(shareCount(0, 50)).toBe(0);
    expect(shareCount(undefined, 50)).toBe(0);
    expect(shareCount(-5, 50)).toBe(0);
  });
});

describe('clampRatio', () => {
  it('holds the 0..100 scale', () => {
    expect(clampRatio(-1)).toBe(0);
    expect(clampRatio(0)).toBe(0);
    expect(clampRatio(100)).toBe(100);
    expect(clampRatio(1000)).toBe(100);
    expect(clampRatio('abc')).toBe(0);
  });
});

describe('toPercentage', () => {
  it('passes a percentage through', () => {
    expect(toPercentage(70)).toBe(70);
    expect(toPercentage('70')).toBe(70);
    expect(toPercentage(100)).toBe(100);
  });

  it('keeps 1 as one percent for a percentage-native field', () => {
    // The distinction from a legacy fraction: here 1 legitimately means 1%.
    expect(toPercentage(1)).toBe(1);
  });

  it('reads a sub-1 value as the fraction it must have been, loudly', () => {
    // #711: a 1.0 meaning "everything" selected 1% and nothing warned.
    const logger = { warn: vi.fn() };

    expect(toPercentage(0.5, { field: 'imageRatio', logger })).toBe(50);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('imageRatio');
  });

  it('takes 1 as everything for the field whose stored format was 0..1', () => {
    const logger = { warn: vi.fn() };

    expect(
      toPercentage(1, {
        field: 'businessAccountRatio',
        legacyFraction: true,
        logger,
      })
    ).toBe(100);
    expect(toPercentage(0.7, { legacyFraction: true, logger })).toBe(70);
  });

  it('is undefined for an absent value, so callers can tell it apart from 0', () => {
    expect(toPercentage(undefined)).toBeUndefined();
    expect(toPercentage(null)).toBeUndefined();
    expect(toPercentage('')).toBeUndefined();
  });
});

describe('selectShare', () => {
  const products = productsOf(50);

  it('selects an exact count', () => {
    expect(selectShare(products, 0, 'images')).toHaveLength(0);
    expect(selectShare(products, 50, 'images')).toHaveLength(25);
    expect(selectShare(products, 100, 'images')).toHaveLength(50);
  });

  it('selects everything at 100 and above, never nothing', () => {
    expect(selectShare(products, 100, 'images')).toHaveLength(50);
    expect(selectShare(products, 150, 'images')).toHaveLength(50);
  });

  it('is reproducible for the same inputs', () => {
    expect(ercs(selectShare(products, 50, 'images'))).toEqual(
      ercs(selectShare(products, 50, 'images'))
    );
  });

  it('does not depend on the order of the list', () => {
    // Keyed on the ERC rather than the index, so a reordered productDataList
    // gives the same share.
    const reversed = [...products].reverse();

    expect(ercs(selectShare(products, 50, 'images')).sort()).toEqual(
      ercs(selectShare(reversed, 50, 'images')).sort()
    );
  });

  it('returns the selection in the order it was given', () => {
    const selected = ercs(selectShare(products, 50, 'images'));

    expect(selected).toEqual([...selected].sort());
  });

  // The property this helper exists for. Index-based selection would give an
  // overlap of min(rA, rB) - the same products carrying every attribute - so
  // asserting the *product* of the ratios is what separates independence from
  // correlation.
  describe('independence', () => {
    const expected = (n, rA, rB) => n * (rA / 100) * (rB / 100);

    it('draws different attributes independently at the same ratio', () => {
      const images = selectShare(products, 50, SELECTION_KEYS.IMAGES);
      const inventory = selectShare(products, 50, SELECTION_KEYS.INVENTORY);

      const shared = overlap(images, inventory);
      const predicted = expected(50, 50, 50);

      // Correlated selection would put this at 25, not near 12.5.
      expect(shared).toBeGreaterThan(predicted * 0.4);
      expect(shared).toBeLessThan(predicted * 1.6);
    });

    it('predicts full overlap when one share is everything', () => {
      // The live config runs imageRatio and pdfRatio at 100, where total
      // overlap is correct rather than evidence of correlation.
      const all = selectShare(products, 100, SELECTION_KEYS.IMAGES);
      const half = selectShare(products, 50, SELECTION_KEYS.BACKORDER);

      expect(overlap(half, all)).toBe(half.length);
    });

    it('draws different ratios of one attribute independently, not nested', () => {
      const fifty = selectShare(products, 50, 'images');
      const sixty = selectShare(products, 60, 'images');

      // Nesting would make this equal fifty.length.
      expect(overlap(fifty, sixty)).toBeLessThan(fifty.length);
    });
  });

  it('spreads the share across the population rather than clustering', () => {
    // Every nth would put the whole share in a predictable stripe; a hash
    // should land roughly half of a 50% share in each half of the catalogue.
    const selected = selectShare(products, 50, 'images');
    const firstHalf = selected.filter(
      (product) => Number(product.externalReferenceCode.slice(-4)) < 25
    ).length;

    expect(firstHalf).toBeGreaterThan(5);
    expect(firstHalf).toBeLessThan(20);
  });

  it('warns rather than silently depending on position when an ERC is missing', () => {
    const logger = { warn: vi.fn() };
    const nameless = [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
      { name: 'd' },
    ];

    expect(selectShare(nameless, 50, 'images', { logger })).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('takes a custom identity for populations keyed differently', () => {
    const accounts = [
      { email: 'a@example.com' },
      { email: 'b@example.com' },
      { email: 'c@example.com' },
      { email: 'd@example.com' },
    ];
    const logger = { warn: vi.fn() };

    const selected = selectShare(accounts, 50, 'accounts', {
      identityOf: (account) => account.email,
      logger,
    });

    expect(selected).toHaveLength(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('survives an empty or missing list', () => {
    expect(selectShare([], 50, 'images')).toEqual([]);
    expect(selectShare(undefined, 50, 'images')).toEqual([]);
  });
});
