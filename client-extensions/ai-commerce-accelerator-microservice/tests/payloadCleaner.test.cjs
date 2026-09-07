const { deepCleanIds } = require('../utils/payload-cleaner.cjs');

describe('Payload Cleaner (Strict ID Guard)', () => {
  it('should remove the root "id" field regardless of value', () => {
    const input = { id: 123, name: 'Test' };
    const result = deepCleanIds(input);
    expect(result).not.toHaveProperty('id');
    expect(result.name).toBe('Test');
  });

  it('should remove specialized IDs if they are 0 or null', () => {
    const input = {
      productId: 0,
      accountId: null,
      skuId: undefined,
      name: 'Test',
    };
    const result = deepCleanIds(input);
    expect(result).not.toHaveProperty('productId');
    expect(result).not.toHaveProperty('accountId');
    expect(result).not.toHaveProperty('skuId');
  });

  it('should remove IDs within the known Mock/Ghost ranges', () => {
    const input = {
      accountId: 10001, // Mock Account range
      productId: 30500, // Mock Product range
      skuId: 40051, // Mock SKU range
      priceListId: 50000, // Mock SKU/Pricing range
    };
    const result = deepCleanIds(input);
    expect(result).not.toHaveProperty('accountId');
    expect(result).not.toHaveProperty('productId');
    expect(result).not.toHaveProperty('skuId');
    expect(result).not.toHaveProperty('priceListId');
  });

  it('should PRESERVE resolved IDs outside of mock ranges', () => {
    const input = {
      productId: 88234, // A "Real" Liferay ID
      accountId: 1234, // A "Real" Liferay ID
      skuId: 999999, // A "Real" Liferay ID
    };
    const result = deepCleanIds(input);
    expect(result.productId).toBe(88234);
    expect(result.accountId).toBe(1234);
    expect(result.skuId).toBe(999999);
  });

  it('should recursively clean nested objects', () => {
    const input = {
      name: 'Root',
      sku: {
        skuId: 40051,
        externalReferenceCode: 'SKU-1',
      },
    };
    const result = deepCleanIds(input);
    // The skuId inside the object should be gone
    expect(result.sku).not.toHaveProperty('skuId');
    expect(result.sku.externalReferenceCode).toBe('SKU-1');
  });

  it('should remove the parent key if the nested object becomes empty after cleaning', () => {
    const input = {
      name: 'Root',
      sku: {
        skuId: 40051, // Only has an invalid ID
      },
    };
    const result = deepCleanIds(input);
    // The entire 'sku' object should be removed because it resulted in {}
    expect(result).not.toHaveProperty('sku');
  });

  it('should handle arrays correctly', () => {
    const input = [
      { id: 1, name: 'Item 1' },
      { productId: 30001, name: 'Item 2' },
      { productId: 888, name: 'Item 3' },
    ];
    const result = deepCleanIds(input);
    expect(result).toHaveLength(3);
    expect(result[0]).not.toHaveProperty('id');
    expect(result[1]).not.toHaveProperty('productId');
    expect(result[2].productId).toBe(888);
  });

  describe('category references (regression)', () => {
    it('keeps the id on nested category references', () => {
      // Liferay resolves categories by id alone and rejects the whole product
      // with "categories/0 must have required property 'id'" without it.
      const result = deepCleanIds({
        externalReferenceCode: 'AICA-PRD-1',
        id: 999,
        categories: [{ id: 34236 }],
      });
      expect(result).not.toHaveProperty('id');
      expect(result.categories).toEqual([{ id: 34236 }]);
    });

    it('drops category references whose id was never resolved', () => {
      const result = deepCleanIds({
        categories: [{ id: 34236 }, { id: 0 }, { id: null }, {}],
      });
      expect(result.categories).toEqual([{ id: 34236 }]);
    });

    it('still strips ids from other nested objects', () => {
      const result = deepCleanIds({
        categories: [{ id: 34236 }],
        skus: [{ id: 40000, sku: 'S1' }],
      });
      expect(result.categories).toEqual([{ id: 34236 }]);
      expect(result.skus).toEqual([{ sku: 'S1' }]);
    });

    it('does not leave empty objects in arrays', () => {
      const result = deepCleanIds({ skus: [{ id: 40000 }, { sku: 'S1' }] });
      expect(result.skus).toEqual([{ sku: 'S1' }]);
    });
  });
});
