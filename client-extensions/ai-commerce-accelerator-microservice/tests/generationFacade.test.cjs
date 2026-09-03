const { GenerationFacade } = require('../services/generationFacade.cjs');

const MINIMAL_VALID_PRODUCT = {
  name: { en_US: 'Valid Product' },
  description: { en_US: 'Valid Description' },
  shortDescription: { en_US: 'Short' },
  urls: { en_US: 'valid-product' },
  baseSku: 'PROD-1',
  productType: 'simple',
  externalReferenceCode: 'AICA-PRD-1',
  skus: [
    {
      sku: 'PROD-1',
      cost: 10,
      price: 20,
      inventoryLevel: 100,
      published: true,
      purchasable: true,
      neverExpire: true,
      externalReferenceCode: 'PROD-1',
    },
  ],
};

describe('GenerationFacade', () => {
  let facade;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      mockDataGenerator: {
        generateProductData: vi.fn().mockResolvedValue([MINIMAL_VALID_PRODUCT]),
      },
      ai: {
        generateProductData: vi.fn().mockResolvedValue([MINIMAL_VALID_PRODUCT]),
      },
    };

    facade = new GenerationFacade(mockCtx);
  });

  it('should route to mock data generator when demoMode is true', async () => {
    const options = { demoMode: true };
    const requestConfig = { aiModel: 'gpt-4o' };

    const result = await facade.generateData(
      'product',
      1,
      requestConfig,
      options
    );

    expect(mockCtx.mockDataGenerator.generateProductData).toHaveBeenCalled();
    expect(mockCtx.ai.generateProductData).not.toHaveBeenCalled();
    expect(result[0].name.en_US).toBe('Valid Product');
  });

  it('should route to AI service when demoMode is false', async () => {
    const options = { demoMode: false };
    const requestConfig = { aiModel: 'gpt-4o' };

    const result = await facade.generateData(
      'product',
      1,
      requestConfig,
      options
    );

    expect(mockCtx.ai.generateProductData).toHaveBeenCalled();
    expect(
      mockCtx.mockDataGenerator.generateProductData
    ).not.toHaveBeenCalled();
    expect(result[0].name.en_US).toBe('Valid Product');
  });

  it('should validate and normalize generated items (inject ERC)', async () => {
    const options = { demoMode: true };
    const requestConfig = {};

    // Product without its own ERC (though schema requires it, we test normalization)
    const { externalReferenceCode: _erc, ...noErcProduct } =
      MINIMAL_VALID_PRODUCT;
    mockCtx.mockDataGenerator.generateProductData.mockResolvedValue([
      noErcProduct,
    ]);

    const result = await facade.generateData(
      'product',
      1,
      requestConfig,
      options
    );

    expect(result[0].externalReferenceCode).toBeDefined();
    expect(result[0].externalReferenceCode).toMatch(/^AICA-BATCH-/);
  });

  it('should preserve the AI-generated specificationKey instead of stripping it (Ajv removeAdditional)', async () => {
    const options = { demoMode: true };
    const requestConfig = {};

    mockCtx.mockDataGenerator.generateProductData.mockResolvedValue([
      {
        ...MINIMAL_VALID_PRODUCT,
        specifications: [
          {
            specificationKey: 'MATERIAL',
            label: { en_US: 'Material' },
            value: { en_US: 'Stainless Steel' },
          },
        ],
      },
    ]);

    const result = await facade.generateData(
      'product',
      1,
      requestConfig,
      options
    );

    expect(result[0].specifications[0].specificationKey).toBe('MATERIAL');
  });

  it('should throw ValidationError when count > 0 but 0 valid items are produced', async () => {
    mockCtx.mockDataGenerator.generateProductData.mockResolvedValue([]);

    await expect(
      facade.generateData('product', 5, {}, { demoMode: true })
    ).rejects.toThrow(/produced 0 valid product items/i);
  });
});

describe('GenerationFacade null-optional repair', () => {
  const Ajv = require('ajv');
  const addFormats = require('ajv-formats');
  const fs = require('fs');
  const path = require('path');
  const {
    dropNullTypeViolations,
    describeOffendingValues,
  } = require('../services/generationFacade.cjs');

  const compile = (name) => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv.compile(
      JSON.parse(
        fs.readFileSync(
          path.join(__dirname, '..', 'generation-schemas', name),
          'utf8'
        )
      )
    );
  };

  const personAccount = () => ({
    accounts: [
      {
        name: 'Alex Vance',
        type: 'person',
        externalReferenceCode: 'ACC-ALEX-VANCE',
        accountContactInformation: {
          emailAddresses: [
            {
              emailAddress: 'alex.vance@example.com',
              primary: true,
              type: 'personal',
            },
          ],
        },
        taxId: null,
        billingAddress: null,
        shippingAddress: null,
        headOfficeAddress: null,
      },
    ],
  });

  it('drops null optional fields so a payload that only failed on nulls validates', () => {
    const validate = compile('account.json');
    const payload = personAccount();

    expect(validate(payload)).toBe(false);

    const dropped = dropNullTypeViolations(payload, validate.errors);

    expect(dropped.sort()).toEqual([
      '/accounts/0/billingAddress',
      '/accounts/0/headOfficeAddress',
      '/accounts/0/shippingAddress',
      '/accounts/0/taxId',
    ]);
    expect(validate(payload)).toBe(true);
  });

  it('leaves populated fields untouched while dropping the nulls', () => {
    const validate = compile('account.json');
    const payload = personAccount();
    validate(payload);
    dropNullTypeViolations(payload, validate.errors);

    const account = payload.accounts[0];
    expect(account.name).toBe('Alex Vance');
    expect(account.externalReferenceCode).toBe('ACC-ALEX-VANCE');
    expect('taxId' in account).toBe(false);
  });

  it('never drops a null the schema explicitly permits', () => {
    const validate = compile('pricing.json');
    const payload = {
      priceListName: 'Base',
      priceEntries: [
        {
          sku: 'S1',
          price: 10,
          externalReferenceCode: 'P1',
          skuExternalReferenceCode: 'S1',
          promoPrice: null,
        },
      ],
    };

    expect(validate(payload)).toBe(true);
    expect(dropNullTypeViolations(payload, validate.errors || [])).toEqual([]);
    expect(payload.priceEntries[0].promoPrice).toBeNull();
  });

  it('reports the offending value alongside the failing path', () => {
    const validate = compile('account.json');
    const payload = personAccount();
    validate(payload);

    const described = describeOffendingValues(payload, validate.errors);

    expect(described['/accounts/0/taxId']).toBe('null');
    expect(described['/accounts/0/billingAddress']).toBe('null');
  });

  it('truncates oversized offending values', () => {
    const payload = { accounts: [{ name: 'x'.repeat(500) }] };
    const described = describeOffendingValues(payload, [
      { instancePath: '/accounts/0/name', keyword: 'type' },
    ]);

    expect(described['/accounts/0/name'].endsWith('...')).toBe(true);
    expect(described['/accounts/0/name'].length).toBeLessThan(260);
  });
});
