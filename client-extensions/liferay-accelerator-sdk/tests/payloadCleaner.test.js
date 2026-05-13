import { describe, it, expect } from 'vitest';
const { deepCleanIds } = require('../src/utils/payload-cleaner.cjs');

describe('payload-cleaner', () => {
  it('should remove the root id field', () => {
    const input = { id: 123, name: 'Test' };
    const output = deepCleanIds(input);
    expect(output).toEqual({ name: 'Test' });
    expect(output.id).toBeUndefined();
  });

  it('should remove placeholder relational IDs', () => {
    const input = {
      productId: 0,
      skuId: 45000, // Mock range
      accountId: 15000, // Mock range
      priceListId: null,
      name: 'Test Product',
    };
    const output = deepCleanIds(input);
    expect(output).toEqual({ name: 'Test Product' });
  });

  it('should keep resolved relational IDs', () => {
    const input = {
      productId: 70001, // Outside mock range
      skuId: 80002, // Outside mock range
      name: 'Test Product',
    };
    const output = deepCleanIds(input);
    expect(output).toEqual({
      productId: 70001,
      skuId: 80002,
      name: 'Test Product',
    });
  });

  it('should recursively clean nested objects', () => {
    const input = {
      name: 'Product',
      skus: [
        { id: 40001, sku: 'S1', productId: 0 },
        { id: 40002, sku: 'S2', productId: 70001 },
      ],
    };
    const output = deepCleanIds(input);
    expect(output).toEqual({
      name: 'Product',
      skus: [{ sku: 'S1' }, { sku: 'S2', productId: 70001 }],
    });
  });

  it('should remove empty nested objects resulting from cleaning', () => {
    const input = {
      name: 'Product',
      sku: { id: 40000 },
    };
    const output = deepCleanIds(input);
    expect(output).toEqual({ name: 'Product' });
    expect(output.sku).toBeUndefined();
  });
});
