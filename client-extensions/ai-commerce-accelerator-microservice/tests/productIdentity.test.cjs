const {
  definitionIdOf,
  deletionTargetIdOf,
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

describe('deletionTargetIdOf', () => {
  // The delete manifest is built from crawled `Product` DTOs, not from
  // productDataList, so it carries Liferay's own field names. The association
  // sweeps address `/products/{x}/productOptions` and
  // `/products/{x}/productSpecifications` with whatever this returns.
  it('reads the definition id from the DTO Liferay returned', () => {
    expect(deletionTargetIdOf(RESOLVED)).toBe(41290);
    expect(deletionTargetIdOf(RESOLVED)).not.toBe(RESOLVED.id);
  });

  it('falls back to the CProduct id, as the delete path always has', () => {
    // A shape carrying only `id` predates the distinction. The fallback
    // cannot detach another product's associations - a CProduct id 404s on
    // every product-scoped path - so it clears nothing rather than the wrong
    // thing.
    expect(deletionTargetIdOf({ id: 41289 })).toBe(41289);
  });

  it('gives nothing when neither id is usable', () => {
    expect(deletionTargetIdOf({ productId: 0, id: -1 })).toBeUndefined();
    expect(deletionTargetIdOf({})).toBeUndefined();
    expect(deletionTargetIdOf(undefined)).toBeUndefined();
  });
});
