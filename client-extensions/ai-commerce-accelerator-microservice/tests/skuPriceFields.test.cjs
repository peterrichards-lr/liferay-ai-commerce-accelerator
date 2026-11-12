const { priceFields } = require('../generators/product-steps/skus.cjs');

/**
 * A SKU's price, promoPrice and cost reach Liferay only when they are a finite
 * number >= 0. Anything else is left off the payload rather than sent, so a
 * bad value from the model costs that one field, not the SKU (#1372).
 */
describe('priceFields', () => {
  it('keeps price, promoPrice and cost when each is a finite number >= 0', () => {
    expect(priceFields({ price: 19.99, promoPrice: 0, cost: 7 })).toEqual({
      price: 19.99,
      promoPrice: 0,
      cost: 7,
    });
  });

  it('accepts numeric strings, as the model sometimes returns them', () => {
    expect(priceFields({ price: '12.50' })).toEqual({ price: 12.5 });
  });

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['non-numeric', 'free'],
  ])('drops a %s value', (_label, value) => {
    expect(priceFields({ price: value, cost: 3 })).toEqual({ cost: 3 });
  });

  it('drops a field that is missing everywhere, rather than sending 0', () => {
    expect(priceFields({ price: 5 })).toEqual({ price: 5 });
  });

  it('falls back field by field when the source has no value', () => {
    expect(
      priceFields(
        { price: 30, cost: null },
        { price: 10, cost: 4, promoPrice: 8 }
      )
    ).toEqual({ price: 30, cost: 4, promoPrice: 8 });
  });

  it('does not fall back when the source value is present but invalid', () => {
    expect(priceFields({ price: -5 }, { price: 10 })).toEqual({});
  });

  it('returns nothing for no source at all', () => {
    expect(priceFields()).toEqual({});
  });

  it('ignores fields other than price, promoPrice and cost', () => {
    expect(priceFields({ price: 1, msrp: 2 })).toEqual({ price: 1 });
  });
});
