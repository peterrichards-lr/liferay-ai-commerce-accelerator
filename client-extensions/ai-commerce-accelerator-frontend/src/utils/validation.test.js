import { describe, expect, it } from 'vitest';
import { getGenerationErrorsMap } from './validation';
import { sectionVisibility } from '../config/generationSections';

/**
 * Covers only what #677 turns on: an error must be raisable on a field the
 * form is showing, and unreachable on one it is not.
 */
describe('getGenerationErrorsMap and the form sections (#677)', () => {
  const config = (overrides = {}) => ({
    accountCount: 10,
    categories: ['Electronics'],
    imageMode: 'placeholder',
    imageRatio: 100,
    orderCount: 50,
    pdfMode: 'placeholder',
    pdfRatio: 100,
    productCount: 10,
    ...overrides,
  });

  it.each([
    ['imageRatio', { imageRatio: 150 }],
    ['pdfRatio', { pdfRatio: 150 }],
    ['customImageFile', { customImageFile: null, imageMode: 'custom' }],
    ['customPDFFile', { customPDFFile: null, pdfMode: 'custom' }],
  ])(
    'raises %s only while the products section is on screen',
    (key, broken) => {
      expect(getGenerationErrorsMap(config(broken))).toHaveProperty(key);
      expect(
        getGenerationErrorsMap(config({ ...broken, productCount: 0 }))
      ).not.toHaveProperty(key);
    }
  );

  it('raises the categories error exactly while the selector is on screen', () => {
    [
      { accountCount: 0, productCount: 10 },
      { accountCount: 10, productCount: 0 },
      { accountCount: 0, productCount: 0 },
    ].forEach((counts) => {
      const empty = config({ ...counts, categories: [] });

      expect(Boolean(getGenerationErrorsMap(empty).categories)).toBe(
        sectionVisibility(empty).categories
      );
    });
  });

  it('still judges the volumes themselves when every section is hidden', () => {
    const errors = getGenerationErrorsMap(
      config({ accountCount: 0, orderCount: 0, productCount: -1 })
    );

    expect(errors).toHaveProperty('productCount');
  });
});
