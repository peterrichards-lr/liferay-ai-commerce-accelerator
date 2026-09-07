const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const MockDataGenerator = require('../generators/mockDataGenerator.cjs');

/**
 * In demo mode `generationFacade` calls the mock generator in place of
 * `aiService`, then runs the same standardise -> validate -> import pipeline.
 * So mock output must satisfy the same generation schemas the AI is asked to
 * satisfy, and nothing checked that. The pricing generator returned a bare
 * array of two fields where its schema declares an object with required
 * `priceListName` and `priceEntries` - drift that had gone unnoticed.
 *
 * These assertions need no API calls and no environment, which matters here:
 * live-mode E2E has not passed in over forty scheduled runs, so this is the
 * only thing standing between mock drift and a failure first seen in real
 * generated data.
 *
 * `product` is deliberately absent. The mock emits `productOptions` and
 * `productSpecifications` while the generation schema declares `options` and
 * `specifications` - and those are not two names for one thing. In Liferay an
 * Option is a definition with its own endpoint, while a ProductOption is the
 * relationship between an option and a product. Which shape the mock should
 * stand in for is a design question, not drift, and asserting either answer
 * here would prejudge it. See #652.
 */
const SCHEMAS = ['account', 'order', 'pricing', 'warehouse'];

function compile(name) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(require(`../generation-schemas/${name}.json`));
}

function describeErrors(errors) {
  return [
    ...new Set(
      (errors || []).map(
        (error) =>
          `${(error.instancePath || '(root)').replace(/\/\d+/g, '/*')} ${
            error.message
          }`
      )
    ),
  ].join('; ');
}

describe('mock generator output satisfies the generation schemas', () => {
  let mock;

  beforeEach(() => {
    mock = new MockDataGenerator({
      liferay: {},
      logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });
  });

  const PRODUCTS = [
    { externalReferenceCode: 'AICA-PRD-1', skus: [{ sku: 'S1' }] },
  ];
  const ACCOUNTS = [{ externalReferenceCode: 'AICA-ACC-1' }];

  // Each case wraps the return value the way generationFacade does before
  // validating: a bare array becomes { <name>s: [...] }. Pricing is not
  // wrapped, because its schema is an object rather than a collection.
  const CASES = {
    account: () => ({
      accounts: mock.generateAccountData(2, {}, 'm', [], ['en-US'], {}),
    }),
    order: () => ({
      orders: mock.generateOrderData(
        PRODUCTS,
        ACCOUNTS,
        2,
        {},
        'm',
        ['en-US'],
        {}
      ),
    }),
    pricing: () =>
      mock.generatePricingData(PRODUCTS, 'standard', {}, 'm', ['en-US']),
    warehouse: () => ({
      warehouses: mock.generateWarehouseData(2, {}, 'm', ['en-US'], {}),
    }),
  };

  for (const name of SCHEMAS) {
    it(`${name}`, () => {
      const validate = compile(name);
      const payload = CASES[name]();

      expect(
        validate(payload),
        `mock ${name} data violates generation-schemas/${name}.json: ${describeErrors(
          validate.errors
        )}`
      ).toBe(true);
    });
  }

  it('pricing returns the object its schema declares, not a bare array', () => {
    // The specific drift this file was written for.
    const pricing = mock.generatePricingData(PRODUCTS, 'standard', {}, 'm', [
      'en-US',
    ]);

    expect(Array.isArray(pricing)).toBe(false);
    expect(pricing.priceListName).toBeTruthy();
    expect(Array.isArray(pricing.priceEntries)).toBe(true);

    for (const entry of pricing.priceEntries) {
      expect(entry.sku).toBeTruthy();
      expect(entry.externalReferenceCode).toBeTruthy();
      expect(entry.skuExternalReferenceCode).toBeTruthy();
      expect(typeof entry.price).toBe('number');
    }
  });
});
