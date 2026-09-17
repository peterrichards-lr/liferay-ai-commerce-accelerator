const {
  applyProductOptions,
  applyProductSpecifications,
  declaresProductOptions,
  mirrorProductOptions,
  productOptionsOf,
  productSpecificationsOf,
} = require('../utils/productShape.cjs');

describe('productShape', () => {
  describe('reading', () => {
    it('prefers Liferay name over the generation schema name', () => {
      const product = {
        options: [{ name: 'schema' }],
        productOptions: [{ name: 'liferay' }],
      };

      expect(productOptionsOf(product)).toEqual([{ name: 'liferay' }]);
    });

    it('falls through an empty Liferay list the way the old reads did', () => {
      // `[] || x` is `[]`, so a product declaring no options under Liferay's
      // name has declared none - the generation schema copy is not consulted.
      expect(productOptionsOf({ options: [{ name: 'schema' }] })).toEqual([
        { name: 'schema' },
      ]);
      expect(
        productOptionsOf({ options: [{ name: 'schema' }], productOptions: [] })
      ).toEqual([]);
    });

    it.each([undefined, null, {}, { options: undefined }])(
      'reads an empty list from %s rather than throwing',
      (product) => {
        expect(productOptionsOf(product)).toEqual([]);
        expect(productSpecificationsOf(product)).toEqual([]);
      }
    );
  });

  describe('declaresProductOptions', () => {
    it('separates an empty declaration from no declaration', () => {
      expect(declaresProductOptions({ options: [] })).toBe(true);
      expect(declaresProductOptions({ productOptions: [] })).toBe(true);
      expect(declaresProductOptions({})).toBe(false);
    });
  });

  describe('writing', () => {
    it('points every name the product carries at one array', () => {
      const product = { options: [{ name: 'old' }], productOptions: [] };
      const replacement = [{ name: 'new' }];

      applyProductOptions(product, replacement);

      expect(product.options).toBe(replacement);
      expect(product.productOptions).toBe(replacement);
    });

    it('never introduces a name the product did not already carry', () => {
      // An extracted dataset holds Liferay's names alone. Adding the schema
      // names would change the shape an export round trip has to preserve.
      const product = {
        productSpecifications: [{ specificationKey: 'brand' }],
      };

      applyProductSpecifications(product, [{ specificationKey: 'colour' }]);

      expect(product).not.toHaveProperty('specifications');
      expect(product.productSpecifications).toEqual([
        { specificationKey: 'colour' },
      ]);
    });

    it('produces a patch that writes nothing for a product carrying neither', () => {
      expect(mirrorProductOptions({}, [{ name: 'new' }])).toEqual({});
    });
  });
});
