import { describe, expect, it } from 'vitest';
import {
  SECTION_FIELDS,
  sectionVisibility,
  withHiddenSectionsDropped,
} from './generationSections';

const COUNTS = ['productCount', 'accountCount', 'orderCount'];

const config = (overrides = {}) => ({
  productCount: 10,
  accountCount: 10,
  orderCount: 50,
  categories: ['Electronics'],
  generatePriceLists: true,
  generateBulkPricing: true,
  generateTierPricing: true,
  generatePromotions: true,
  generateSpecifications: true,
  generateSkuVariants: true,
  imageMode: 'placeholder',
  imageRatio: 100,
  imageStyle: 'photographic',
  customImageFile: null,
  pdfMode: 'placeholder',
  pdfRatio: 100,
  pdfContentType: 'product_info',
  customPDFFile: null,
  createWarehouses: true,
  reuseExistingWarehouses: true,
  warehouseCount: 5,
  inventoryMin: 0,
  inventoryMax: 1000,
  inventoryAssignmentRatio: 100,
  enableBackorders: true,
  backorderAssignmentRatio: 50,
  accountType: 'business',
  businessAccountRatio: 70,
  orderAccountType: 'business',
  orderDateRangeDays: 365,
  orderDistribution: { open: 25, processing: 25, shipped: 25, completed: 25 },
  ...overrides,
});

describe('sectionVisibility', () => {
  it.each([
    ['products', 'productCount'],
    ['accounts', 'accountCount'],
    ['orders', 'orderCount'],
  ])('shows %s only while %s is above zero', (section, countField) => {
    expect(sectionVisibility(config({ [countField]: 1 }))[section]).toBe(true);
    expect(sectionVisibility(config({ [countField]: 0 }))[section]).toBe(false);
  });

  it.each([
    ['an absent count', undefined],
    ['a blank count', ''],
    ['a non-numeric count', 'ten'],
  ])('treats %s as nothing to configure', (_label, value) => {
    expect(sectionVisibility(config({ productCount: value })).products).toBe(
      false
    );
  });

  it('shows the categories selector for products or accounts alone', () => {
    expect(sectionVisibility(config({ accountCount: 0 })).categories).toBe(
      true
    );
    expect(sectionVisibility(config({ productCount: 0 })).categories).toBe(
      true
    );
    expect(
      sectionVisibility(config({ accountCount: 0, productCount: 0 })).categories
    ).toBe(false);
  });

  it('asks for an order account type only when the run creates no accounts', () => {
    expect(
      sectionVisibility(config({ accountCount: 0 })).orderAccountType
    ).toBe(true);
    expect(sectionVisibility(config()).orderAccountType).toBe(false);
    expect(
      sectionVisibility(config({ accountCount: 0, orderCount: 0 }))
        .orderAccountType
    ).toBe(false);
  });
});

describe('SECTION_FIELDS', () => {
  it('never lets a section own the count that reveals it', () => {
    const owned = Object.values(SECTION_FIELDS).flat();

    COUNTS.forEach((countField) => expect(owned).not.toContain(countField));
  });
});

describe('withHiddenSectionsDropped', () => {
  const submitted = (overrides) => withHiddenSectionsDropped(config(overrides));

  // Every section but `orderAccountType`, which by definition cannot share a
  // screen with the accounts section.
  it('keeps every field whose section is on screen', () => {
    const shown = config({ orderAccountType: undefined });

    expect(withHiddenSectionsDropped(shown)).toEqual(shown);
  });

  it('drops the product settings when no products are asked for', () => {
    const result = submitted({ productCount: 0 });

    SECTION_FIELDS.products.forEach((field) =>
      expect(result[field]).toBeUndefined()
    );
    expect(result.accountType).toBe('business');
    expect(result.orderDateRangeDays).toBe(365);
  });

  it('drops the account settings when no accounts are asked for', () => {
    const result = submitted({ accountCount: 0 });

    expect(result.accountType).toBeUndefined();
    expect(result.businessAccountRatio).toBeUndefined();
    expect(result.imageMode).toBe('placeholder');
  });

  it('drops the order settings when no orders are asked for', () => {
    const result = submitted({ orderCount: 0 });

    expect(result.orderDateRangeDays).toBeUndefined();
    expect(result.orderDistribution).toBeUndefined();
    expect(result.orderAccountType).toBeUndefined();
    expect(result.imageMode).toBe('placeholder');
  });

  it('keeps the categories while either products or accounts are asked for', () => {
    expect(submitted({ productCount: 0 }).categories).toEqual(['Electronics']);
    expect(submitted({ accountCount: 0 }).categories).toEqual(['Electronics']);
    expect(
      submitted({ accountCount: 0, productCount: 0 }).categories
    ).toBeUndefined();
  });

  it('drops the order account type when the run creates its own accounts', () => {
    expect(submitted().orderAccountType).toBeUndefined();
    expect(submitted({ accountCount: 0 }).orderAccountType).toBe('business');
  });

  it('drops the AICA-owned opt-in with the section it belongs to (#824)', () => {
    // It narrows which *existing* accounts may receive orders, so it governs
    // nothing on a run that creates its own - and a request must not carry a
    // setting the operator was never asked about (#677).
    expect(
      submitted({ aicaOwnedEntitiesOnly: true }).aicaOwnedEntitiesOnly
    ).toBeUndefined();

    expect(
      submitted({ accountCount: 0, aicaOwnedEntitiesOnly: true })
        .aicaOwnedEntitiesOnly
    ).toBe(true);
  });

  it('never drops a volume, whatever it is set to', () => {
    const result = submitted({
      accountCount: 0,
      orderCount: 0,
      productCount: 0,
    });

    COUNTS.forEach((countField) =>
      expect(result).toHaveProperty(countField, 0)
    );
  });

  it('drops nothing for a seed pack, whose dataset these counts do not describe', () => {
    const withSeedPack = config({
      accountCount: 0,
      orderCount: 0,
      productCount: 0,
      seedPack: 'industrial-power-tools',
    });

    expect(withHiddenSectionsDropped(withSeedPack)).toEqual(withSeedPack);
  });

  it('leaves the config it was given untouched', () => {
    const original = config({ orderCount: 0 });
    const copy = { ...original };

    withHiddenSectionsDropped(original);

    expect(original).toEqual(copy);
  });

  it('overrides rather than omits, so a merge behind it cannot restore a dropped field', () => {
    const state = config({ orderCount: 0 });
    const request = { ...state, ...withHiddenSectionsDropped(state) };

    expect(request.orderDateRangeDays).toBeUndefined();
    expect(JSON.parse(JSON.stringify(request))).not.toHaveProperty(
      'orderDateRangeDays'
    );
  });
});
