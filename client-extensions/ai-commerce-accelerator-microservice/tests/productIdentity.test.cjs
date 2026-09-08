const {
  definitionIdOf,
  productIdentity,
} = require('../utils/productIdentity.cjs');

// The DTO shape Liferay actually returns: `id` is the CProduct, `productId`
// is the CPDefinition. Measured on a live instance, product 41289/41290.
const RESOLVED = {
  externalReferenceCode: 'AICA-PRD-0001',
  id: 41289,
  productId: 41290,
};

describe('productIdentity', () => {
  it('keeps both ids under names that say which is which', () => {
    expect(productIdentity(RESOLVED)).toEqual({
      cProductId: 41289,
      cpDefinitionId: 41290,
    });
  });

  it('leaves an unresolved id absent rather than zero', () => {
    // A caller must be able to tell "not resolved" from "resolved to nothing";
    // a 0 would be sent as a path segment and 404.
    expect(productIdentity({ id: 41289 })).toEqual({
      cProductId: 41289,
      cpDefinitionId: undefined,
    });
    expect(productIdentity({})).toEqual({
      cProductId: undefined,
      cpDefinitionId: undefined,
    });
    expect(productIdentity(undefined)).toEqual({
      cProductId: undefined,
      cpDefinitionId: undefined,
    });
  });

  it('rejects a non-positive or unparseable id', () => {
    expect(productIdentity({ id: 0, productId: -1 })).toEqual({
      cProductId: undefined,
      cpDefinitionId: undefined,
    });
    expect(productIdentity({ id: 'nope' }).cProductId).toBeUndefined();
  });

  it('accepts an id Liferay sent as a string', () => {
    expect(productIdentity({ id: '41289', productId: '41290' })).toEqual({
      cProductId: 41289,
      cpDefinitionId: 41290,
    });
  });
});

describe('definitionIdOf', () => {
  // Every product-scoped catalog path takes the definition id. Passing the
  // CProduct id 404s on options, specifications, images and attachments, and -
  // worse - returns 200 with an empty collection on skus and product-channels,
  // which reads as "this product has none" rather than as an error (#748).
  it('gives the definition id, never the CProduct id', () => {
    const product = { ...RESOLVED, ...productIdentity(RESOLVED) };

    expect(definitionIdOf(product)).toBe(41290);
    expect(definitionIdOf(product)).not.toBe(product.cProductId);
  });

  it('falls back to nothing rather than to the CProduct id', () => {
    // Falling back would build a request that either 404s or silently answers
    // with an empty collection. Both are worse than not making the call.
    expect(definitionIdOf({ cProductId: 41289 })).toBeUndefined();
    expect(definitionIdOf({})).toBeUndefined();
    expect(definitionIdOf(undefined)).toBeUndefined();
  });
});
