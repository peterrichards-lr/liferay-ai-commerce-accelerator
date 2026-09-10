const productSchema = require('../generation-schemas/product.json');
const {
  FROM,
  PRODUCT_FIELDS,
  PRODUCT_SHAPE_KEYS,
  REQUIRED_PRODUCT_KEYS,
  commonPrefix,
  translateProduct,
  translateSkuOptions,
  translateWarehouse,
} = require('../utils/datasetTranslation.cjs');

// #849: the package holds the generator's shape, not Liferay's, so an extract
// has to translate - and that is where a field gets silently dropped and
// nobody notices until a promoted catalogue is missing something. These tests
// are the guard against that specifically: the first block makes the schema
// and the declaration keep each other honest, and the rest assert the
// translation against DTO shapes taken from a live instance.

const SCHEMA_PRODUCT = productSchema.properties.products.items;
const SCHEMA_KEYS = Object.keys(SCHEMA_PRODUCT.properties);

describe('the declared translation matches the generation schema', () => {
  it('declares every key the schema does', () => {
    // The failure this catches: a key added to product.json and not here would
    // never be extracted, and no other test would notice, because a product
    // missing a field is still a valid product.
    expect([...PRODUCT_SHAPE_KEYS].sort()).toEqual([...SCHEMA_KEYS].sort());
  });

  it('declares nothing the schema does not', () => {
    for (const key of PRODUCT_SHAPE_KEYS) {
      expect(SCHEMA_KEYS).toContain(key);
    }
  });

  it('agrees with the schema about what is required', () => {
    expect([...REQUIRED_PRODUCT_KEYS].sort()).toEqual(
      [...SCHEMA_PRODUCT.required].sort()
    );
  });

  it('gives every key a source and a reason', () => {
    for (const key of PRODUCT_SHAPE_KEYS) {
      const field = PRODUCT_FIELDS[key];

      expect(Object.values(FROM)).toContain(field.from);
      // An absent key without a stated reason is the thing this whole
      // declaration exists to prevent - a silent drop with a tidy name on it.
      expect(field.note.length).toBeGreaterThan(20);
    }
  });

  it('states why each absent key is absent rather than leaving it blank', () => {
    const absent = PRODUCT_SHAPE_KEYS.filter(
      (key) => PRODUCT_FIELDS[key].from === FROM.ABSENT
    );

    // Exactly one today. If this grows, the reason has been written down and
    // the growth was deliberate; that is the whole point of asserting it.
    expect(absent).toEqual(['catalogId']);
    expect(PRODUCT_FIELDS.catalogId.note).toMatch(/config\.catalogId/);
  });
});

/**
 * Shapes taken from the SDK's recorded live payloads
 * (api-schemas/examples/reference-{product,sku,option}.json), widened with the
 * fields the generation shape needs and the OpenAPI declares.
 */
const LIFERAY_PRODUCT = {
  active: true,
  catalogId: 61432,
  categories: [
    {
      externalReferenceCode: 'CAT-BRAKING',
      id: 70910,
      name: 'Braking',
      title: { en_US: 'Braking', fr_FR: 'Freinage' },
      vocabulary: 'Category',
    },
  ],
  description: { en_US: 'A high-boiling DOT 4 brake fluid.' },
  externalReferenceCode: 'MIN93016',
  id: 71550,
  metaDescription: { en_US: 'DOT 4 brake fluid' },
  metaKeyword: { en_US: 'brake,fluid,dot4' },
  metaTitle: { en_US: 'Brake Fluid' },
  name: { en_US: 'Brake Fluid' },
  productConfiguration: { allowBackOrder: true },
  productId: 71551,
  productType: 'simple',
  shortDescription: { en_US: 'DOT 4 brake fluid.' },
  urls: { en_US: 'brake-fluid' },
};

const LIFERAY_OPTIONS = [
  {
    fieldType: 'select',
    id: 71565,
    key: 'package-quantity',
    name: { en_US: 'Package Quantity' },
    optionId: 71501,
    productOptionValues: [
      { id: 71566, key: 'x12', name: { en_US: '12' } },
      { id: 71567, key: 'x24', name: { en_US: '24' } },
    ],
    skuContributor: true,
  },
];

const LIFERAY_SPECIFICATIONS = [
  {
    externalReferenceCode: 'PS-71600',
    id: 71600,
    label: { en_US: 'Quantity' },
    productId: 71551,
    specificationExternalReferenceCode: 'a630a0e0-6a1b-fdb2-c795-dae73bd08b4b',
    specificationId: 71512,
    specificationKey: 'quantity',
    value: { en_US: '1 litre' },
  },
];

const LIFERAY_VARIANT_SKUS = [
  {
    cost: 40,
    externalReferenceCode: 'MIN93016A',
    id: 71569,
    inventoryLevel: 100,
    price: 80,
    productId: 71551,
    purchasable: true,
    sku: 'MIN93016A',
    skuOptions: [
      {
        key: 'package-quantity',
        optionId: 71565,
        optionValueId: 71566,
        value: '12',
      },
    ],
  },
  {
    cost: 70,
    externalReferenceCode: 'MIN93016B',
    id: 71570,
    inventoryLevel: 0,
    price: 140,
    productId: 71551,
    purchasable: true,
    sku: 'MIN93016B',
    skuOptions: [
      {
        key: 'package-quantity',
        optionId: 71565,
        optionValueId: 71567,
        value: '24',
      },
    ],
  },
];

function translate(overrides = {}) {
  return translateProduct({
    attachments: [],
    images: [],
    options: LIFERAY_OPTIONS,
    priceEntries: [],
    product: LIFERAY_PRODUCT,
    skus: LIFERAY_VARIANT_SKUS,
    specifications: LIFERAY_SPECIFICATIONS,
    ...overrides,
  });
}

describe('translating a Liferay product into the generation shape', () => {
  it('carries the identity and the text the import cannot do without', () => {
    const { product } = translate();

    expect(product.externalReferenceCode).toBe('MIN93016');
    expect(product.name).toEqual({ en_US: 'Brake Fluid' });
    expect(product.description).toEqual({
      en_US: 'A high-boiling DOT 4 brake fluid.',
    });
    expect(product.shortDescription).toEqual({ en_US: 'DOT 4 brake fluid.' });
    expect(product.urls).toEqual({ en_US: 'brake-fluid' });
    expect(product.productType).toBe('simple');
  });

  it('emits the category by name, not by the id ensure-categories produces', () => {
    // The id belongs to the source instance's taxonomy. ensure-categories
    // consumes `category` and writes `categories`; extracting the id would be
    // extracting its output rather than its input.
    const { product } = translate();

    expect(product.category).toEqual({ en_US: 'Braking', fr_FR: 'Freinage' });
    expect(product.categories).toBeUndefined();
  });

  it('drops the catalog id rather than promising an id the target will not have', () => {
    const { product } = translate();

    expect(product).not.toHaveProperty('catalogId');
  });

  it('keeps allowBackOrder, which nothing on the import path recomputes', () => {
    // markBackorderShare runs only on the AI branch, so an import takes what
    // the dataset says. Dropping it would silently turn backorders off across
    // a promoted catalogue.
    expect(translate().product.allowBackOrder).toBe(true);

    const { product } = translate({
      product: { ...LIFERAY_PRODUCT, productConfiguration: {} },
    });

    expect(product.allowBackOrder).toBeUndefined();
  });

  it('separates variants from base SKUs by whether Liferay linked options', () => {
    const { product } = translate();

    expect(product.skuVariants.map((v) => v.sku)).toEqual([
      'MIN93016A',
      'MIN93016B',
    ]);
    // Liferay holds no base SKU for a product with SKU-contributing options,
    // so one is derived - the schema requires a non-empty list and
    // coverPriceEntries reads it as the price template.
    expect(product.skus).toHaveLength(1);
    expect(product.skus[0].sku).toBe('MIN93016');
    expect(product.baseSku).toBe('MIN93016');
  });

  it('rebuilds a variant option selection as the name-to-name map create-skus reads', () => {
    // Sku.skuOptions carries relationship ids that mean nothing in another
    // instance. resolveSkuOptionLink matches on names, so names are what
    // travel.
    const { product } = translate();

    expect(product.skuVariants[0].options).toEqual({
      'Package Quantity': '12',
    });
    expect(product.skuVariants[1].options).toEqual({
      'Package Quantity': '24',
    });
  });

  it('derives priceModifier and inStock, which Liferay does not store', () => {
    const { product } = translate();

    // 80 is the cheapest variant and so the base; 140 is 75% above it.
    expect(product.skuVariants[0].priceModifier).toBe(0);
    expect(product.skuVariants[1].priceModifier).toBe(0.75);
    expect(product.skuVariants[0].inStock).toBe(true);
    expect(product.skuVariants[1].inStock).toBe(false);
  });

  it('lower-cases the field type, because GraphQL answers SELECT and the enum is lower case', () => {
    const { product } = translate({
      options: [{ ...LIFERAY_OPTIONS[0], fieldType: 'SELECT' }],
    });

    expect(product.options[0].fieldType).toBe('select');
  });

  it('flattens option values to the names ensure-options matches on', () => {
    const { product } = translate();

    expect(product.options[0]).toMatchObject({
      key: 'package-quantity',
      name: { en_US: 'Package Quantity' },
      productOptionValues: ['12', '24'],
      skuContributor: true,
    });
  });

  it('keeps a specification label and drops the source instance reference codes', () => {
    const { product } = translate();

    expect(product.specifications).toEqual([
      {
        label: { en_US: 'Quantity' },
        specificationKey: 'quantity',
        value: { en_US: '1 litre' },
      },
    ]);
  });

  it('treats a base SKU as a base SKU when Liferay linked no options', () => {
    const { product } = translate({
      options: [],
      skus: [
        {
          cost: 40,
          externalReferenceCode: 'MIN93017',
          inventoryLevel: 12,
          price: 90,
          sku: 'MIN93017',
          skuOptions: [],
        },
      ],
    });

    expect(product.skuVariants).toEqual([]);
    expect(product.skus).toEqual([
      {
        cost: 40,
        externalReferenceCode: 'MIN93017',
        inventoryLevel: 12,
        price: 90,
        sku: 'MIN93017',
      },
    ]);
  });
});

describe('reporting what the instance could not answer', () => {
  it('names each unfilled declared key and whether the schema required it', () => {
    const { missing } = translate({
      product: {
        ...LIFERAY_PRODUCT,
        description: undefined,
        urls: undefined,
        metaKeyword: undefined,
      },
    });

    const byKey = Object.fromEntries(missing.map((m) => [m.key, m.required]));

    expect(byKey.description).toBe(true);
    expect(byKey.urls).toBe(true);
    expect(byKey.metaKeyword).toBe(false);
  });

  it('omits an unfilled key rather than emitting a null the import reads as data', () => {
    const { product } = translate({
      product: { ...LIFERAY_PRODUCT, metaTitle: undefined },
    });

    expect(product).not.toHaveProperty('metaTitle');
  });

  it('does not report a key the declaration says is deliberately absent', () => {
    const { missing } = translate();

    expect(missing.map((m) => m.key)).not.toContain('catalogId');
  });
});

describe('translating a warehouse', () => {
  const LIFERAY_WAREHOUSE = {
    active: true,
    city: 'London',
    countryISOCode: 'GB',
    description: { en_US: 'Southern distribution' },
    externalReferenceCode: 'AICA-WH-LONDON',
    id: 71491,
    latitude: 51.5072,
    longitude: -0.1276,
    name: { en_US: 'London' },
    regionISOCode: 'LND',
    street1: '1 Bankside',
    zip: 'SE1 9AA',
  };

  it('removes the id, which create-warehouses reads as "already exists"', () => {
    // The trap: create-warehouses filters to !warehouse.id on the rule that a
    // warehouse carrying one was adopted from the target (#730). A source
    // instance's id would satisfy that for every warehouse in the dataset and
    // the import would create none of them, reporting success.
    const translated = translateWarehouse(LIFERAY_WAREHOUSE);

    expect(translated).not.toHaveProperty('id');
    expect(translated.externalReferenceCode).toBe('AICA-WH-LONDON');
    expect(translated.city).toBe('London');
    expect(translated.countryISOCode).toBe('GB');
    expect(translated.latitude).toBe(51.5072);
  });
});

describe('the derivations', () => {
  it('takes the shared prefix of variant codes, trimmed of its separator', () => {
    expect(commonPrefix(['MIN93016-BLK-L', 'MIN93016-RED-S'])).toBe('MIN93016');
    expect(commonPrefix(['SOLO'])).toBe('SOLO');
    expect(commonPrefix([])).toBeUndefined();
  });

  it('falls back to the skuOption value when the product option is not expanded', () => {
    // Liferay does not always expand productOptionValues, and the value text
    // is on the SKU option itself. Losing the selection entirely would leave
    // an inactive SKU in the target.
    const selections = translateSkuOptions(
      [{ key: 'package-quantity', optionValueId: 99999, value: '48' }],
      LIFERAY_OPTIONS
    );

    expect(selections).toEqual({ 'Package Quantity': '48' });
  });
});
