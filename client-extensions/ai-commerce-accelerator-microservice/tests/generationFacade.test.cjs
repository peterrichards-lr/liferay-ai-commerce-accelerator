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
});
