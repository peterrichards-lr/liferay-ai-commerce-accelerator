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
});
