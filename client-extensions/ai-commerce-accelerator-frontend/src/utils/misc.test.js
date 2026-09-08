import { normalizeEntityType } from './misc';

describe('normalizeEntityType', () => {
  it('classifies resolve-sku-ids as skus, not products', () => {
    expect(normalizeEntityType('resolve-sku-ids')).toBe('skus');
  });

  it('classifies create-skus as skus', () => {
    expect(normalizeEntityType('create-skus')).toBe('skus');
  });

  it('still classifies create-products as products', () => {
    expect(normalizeEntityType('create-products')).toBe('products');
  });

  // Inventory submits one item per SKU-warehouse pair. Counted as products it
  // grew the product total to the sum of both, so a 50-product run with 200
  // SKUs reported "Products 250/250" (#752).
  it('classifies inventory as its own entity, not as products', () => {
    expect(normalizeEntityType('update-inventory')).toBe('inventory');
    expect(normalizeEntityType('inventory')).toBe('inventory');
  });
});
