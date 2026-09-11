const {
  portableProduct,
  toPortableDataset,
  withoutInstanceKeys,
} = require('../utils/datasetPortability.cjs');

// #929: an exported package carried warehouses with their source instance id.
// `create-warehouses` filters to `!warehouse.id` (#730), so it created none of
// them, reported success, and the import failed one step later resolving
// warehouses that did not exist. Found by a round trip - generate, export,
// delete, import - because every cheaper test either had the warehouses
// already or used fixtures written by hand with no id.

const ADOPTED_WAREHOUSE = {
  actions: { get: { href: 'http://source.invalid/o/…/warehouses/36830' } },
  active: true,
  city: 'Lahore',
  countryISOCode: 'PK',
  externalReferenceCode: 'AICA-WH-1788976769613-5-ca9858cf',
  id: 36830,
  name: { en_US: 'Solara Punjab Logistics Center' },
  street1: '1 Example Road',
  zip: '54000',
};

const STAMPED_PRODUCT = {
  externalReferenceCode: 'AICA-PRD-1789131919713-0-9b651a66',
  name: { en_US: 'Professional Electronics 1' },
  productOptions: [
    { key: 'COLOR', optionId: 36898 },
    { key: 'SIZE', optionId: 36894 },
  ],
  productSpecifications: [
    {
      specificationExternalReferenceCode: 'AICA-SPEC-BRA-NA',
      specificationId: 38449,
      specificationKey: 'brand',
      value: { en_US: 'AICA Elite' },
    },
  ],
  skus: [{ sku: 'SKU-ELE-001' }],
};

describe('Making a session dataset portable', () => {
  it('drops the warehouse id that makes an import create nothing', () => {
    const [warehouse] = toPortableDataset({
      warehouses: [ADOPTED_WAREHOUSE],
    }).warehouses;

    // The whole defect in one assertion: with `id` present, create-warehouses
    // treats it as already adopted and skips it.
    expect(warehouse.id).toBeUndefined();
    expect(warehouse.externalReferenceCode).toBe(
      'AICA-WH-1788976769613-5-ca9858cf'
    );
    expect(warehouse.name).toEqual({ en_US: 'Solara Punjab Logistics Center' });
    expect(warehouse.city).toBe('Lahore');
  });

  it('drops the actions block, which is absolute URLs to the source', () => {
    const [warehouse] = toPortableDataset({
      warehouses: [ADOPTED_WAREHOUSE],
    }).warehouses;

    expect(warehouse.actions).toBeUndefined();
    expect(JSON.stringify(warehouse)).not.toContain('source.invalid');
  });

  it('translates a stamped id into the code that travels', () => {
    // The package carries the definitions those ids point at, so the reference
    // can be rewritten rather than deleted: the target creates the option,
    // mints its own id, and matches on the code.
    const dataset = toPortableDataset({
      optionDefinitions: [
        { externalReferenceCode: 'AICAOPT-COLOR', id: 36898, key: 'COLOR' },
        { externalReferenceCode: 'AICAOPT-SIZE', id: 36894, key: 'SIZE' },
      ],
      products: [STAMPED_PRODUCT],
      specificationDefinitions: [
        { externalReferenceCode: 'AICA-SPEC-BRA-NA', id: 38449, key: 'brand' },
      ],
    });

    const [product] = dataset.products;

    // Liferay's ids are sequential per instance, so these do not dangle on a
    // different one - they resolve, to something else.
    expect(product.productOptions[0].optionId).toBeUndefined();
    expect(product.productSpecifications[0].specificationId).toBeUndefined();

    expect(product.productOptions).toEqual([
      { key: 'COLOR', optionExternalReferenceCode: 'AICAOPT-COLOR' },
      { key: 'SIZE', optionExternalReferenceCode: 'AICAOPT-SIZE' },
    ]);
    expect(product.productSpecifications[0]).toMatchObject({
      specificationExternalReferenceCode: 'AICA-SPEC-BRA-NA',
      specificationKey: 'brand',
      value: { en_US: 'AICA Elite' },
    });
    expect(product.skus).toEqual([{ sku: 'SKU-ELE-001' }]);
  });

  it('drops the relationship ids, which have no portable form at all', () => {
    // link-product-options records what it built on the source: the product's
    // own option relationship and its value relationships. The target builds
    // its own, so these are ids that would address a different entity there -
    // the shape of #662, where a plausible id reached a SKU.
    const [product] = toPortableDataset({
      optionDefinitions: [
        { externalReferenceCode: 'AICA-OPT-COLOR', id: 36898 },
      ],
      products: [
        {
          externalReferenceCode: 'AICA-PRD-1',
          productOptions: [
            {
              key: 'COLOR',
              optionId: 36898,
              productOptionId: 38525,
              productOptionValues: ['Red', 'Blue'],
              productOptionValuesWithIds: [
                {
                  key: 'red',
                  name: { en_US: 'Red' },
                  productOptionValueId: 38526,
                },
              ],
            },
          ],
        },
      ],
    }).products;

    const [option] = product.productOptions;

    expect(option.productOptionId).toBeUndefined();
    expect(option.productOptionValuesWithIds).toBeUndefined();

    // What the target matches on survives: the key, the code, and the names.
    expect(option).toEqual({
      key: 'COLOR',
      optionExternalReferenceCode: 'AICA-OPT-COLOR',
      productOptionValues: ['Red', 'Blue'],
    });
  });

  it('drops a reference it cannot translate rather than keeping a wrong number', () => {
    // No definition in the package means no portable identity to offer. A
    // number that resolves to something else on the target is worse than
    // nothing, and `key` still carries the match.
    const [product] = toPortableDataset({
      optionDefinitions: [],
      products: [STAMPED_PRODUCT],
      specificationDefinitions: [],
    }).products;

    expect(product.productOptions).toEqual([{ key: 'COLOR' }, { key: 'SIZE' }]);
    expect(
      product.productSpecifications[0].specificationExternalReferenceCode
    ).toBe('AICA-SPEC-BRA-NA');
    expect(product.productSpecifications[0].specificationId).toBeUndefined();
  });

  it('keeps a code the product already carried over one it could look up', () => {
    const [product] = toPortableDataset({
      optionDefinitions: [
        { externalReferenceCode: 'AICAOPT-FROM-DEFINITION', id: 36898 },
      ],
      products: [
        {
          externalReferenceCode: 'AICA-PRD-1',
          productOptions: [
            {
              key: 'COLOR',
              optionExternalReferenceCode: 'AICAOPT-ON-THE-PRODUCT',
              optionId: 36898,
            },
          ],
        },
      ],
    }).products;

    expect(product.productOptions[0].optionExternalReferenceCode).toBe(
      'AICAOPT-ON-THE-PRODUCT'
    );
  });

  it('strips ids from the specification and option definitions', () => {
    const dataset = toPortableDataset({
      optionDefinitions: [
        {
          actions: {},
          externalReferenceCode: 'AICAOPT-COLOR',
          id: 36898,
          key: 'COLOR',
        },
      ],
      specificationDefinitions: [
        { externalReferenceCode: 'AICA-SPEC-BRA-NA', id: 38449, key: 'brand' },
      ],
    });

    expect(dataset.specificationDefinitions[0].id).toBeUndefined();
    expect(dataset.specificationDefinitions[0].externalReferenceCode).toBe(
      'AICA-SPEC-BRA-NA'
    );
    expect(dataset.optionDefinitions[0].id).toBeUndefined();
    expect(dataset.optionDefinitions[0].actions).toBeUndefined();
    expect(dataset.optionDefinitions[0].key).toBe('COLOR');
  });

  it('leaves an already portable dataset alone', () => {
    // The extract path normalises on the way out, so the two producers have to
    // converge here rather than disagree about what a package contains.
    const portable = toPortableDataset({
      optionDefinitions: [],
      products: [
        {
          externalReferenceCode: 'AICA-PRD-1',
          productSpecifications: [{ specificationKey: 'brand' }],
          skus: [{ sku: 'S1' }],
        },
      ],
      specificationDefinitions: [],
      warehouses: [
        {
          active: true,
          externalReferenceCode: 'AICA-WH-1',
          name: { en_US: 'Depot' },
        },
      ],
    });

    expect(toPortableDataset(portable)).toEqual(portable);
    expect(portable.products[0].externalReferenceCode).toBe('AICA-PRD-1');
    expect(portable.warehouses[0].externalReferenceCode).toBe('AICA-WH-1');
  });

  it('keeps the rest of the dataset untouched', () => {
    const dataset = toPortableDataset({
      accounts: [{ externalReferenceCode: 'AICA-ACC-1' }],
      images: [{ productERC: 'AICA-PRD-1', title: 'x' }],
      metadata: { sessionId: 'AICA-SESSION-1', source: 'session-db' },
      orders: [],
    });

    expect(dataset.metadata).toEqual({
      sessionId: 'AICA-SESSION-1',
      source: 'session-db',
    });
    expect(dataset.accounts).toEqual([{ externalReferenceCode: 'AICA-ACC-1' }]);
    expect(dataset.images).toEqual([{ productERC: 'AICA-PRD-1', title: 'x' }]);
  });

  it('survives the shapes a half-written context produces', () => {
    expect(toPortableDataset(null)).toBeNull();
    expect(toPortableDataset({}).warehouses).toEqual([]);
    expect(withoutInstanceKeys(undefined)).toBeUndefined();
    expect(portableProduct({ productOptions: [null] }).productOptions).toEqual([
      {},
    ]);
  });
});
