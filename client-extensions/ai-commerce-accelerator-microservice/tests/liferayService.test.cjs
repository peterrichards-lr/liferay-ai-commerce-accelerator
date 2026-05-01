const { LiferayService } = require('../services/liferay/index.cjs');
const OAuthService = require('../services/liferay/oauth.cjs');
const ContractValidator = require('../services/contractValidator.cjs');

describe('LiferayService', () => {
  let liferayService;
  let mockCtx;
  const config = {
    liferayUrl: 'http://liferay:8080',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  };

  beforeEach(() => {
    const mockCache = new Map();
    mockCtx = {
      cache: {
        get: (key) => mockCache.get(key),
        set: (key, value) => mockCache.set(key, value),
        clear: () => mockCache.clear(),
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
      },
      config: {},
    };
    mockCtx.oauth = new OAuthService(mockCtx);
    mockCtx.contractValidator = new ContractValidator(mockCtx);
    liferayService = new LiferayService(mockCtx);

    // Mock getExclusions to avoid needing real persistence logic in discovery tests
    liferayService._getExclusions = vi.fn().mockResolvedValue([]);
  });

  it('should fetch products using the mocked Liferay API', async () => {
    const result = await liferayService.getProducts(config, { catalogId: 123 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Test Product 1');
    expect(result.items[0].catalogId).toBe(123);
    expect(result.totalCount).toBe(1);
  });

  it('should fetch accounts using the mocked Liferay API', async () => {
    const result = await liferayService.getAccounts(config);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Test Account 1');
    expect(result.items[0].externalReferenceCode).toBe('ACC-1');
    expect(result.totalCount).toBe(1);
  });

  it('should fetch orders using the mocked Liferay API', async () => {
    const result = await liferayService.getOrders(config);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].externalReferenceCode).toBe('ORD-1');
    expect(result.totalCount).toBe(1);
  });

  it('should fetch price lists using the mocked Liferay API', async () => {
    const result = await liferayService.getPriceLists(config);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Test Price List 1');
    expect(result.totalCount).toBe(1);
  });

  it('should fetch warehouses using the mocked Liferay API', async () => {
    const result = await liferayService.getWarehouses(config);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Test Warehouse 1');
    expect(result.totalCount).toBe(1);
  });

  it('should fetch batch status using the mocked Liferay API', async () => {
    const result = await liferayService.getImportTask(config, 9001);

    expect(result.executeStatus).toBe('COMPLETED');
    expect(result.processedItemsCount).toBe(10);
    expect(result.totalItemsCount).toBe(10);
    expect(result.id).toBe(9001);
  });

  it('should fail to create products batch if contract is violated', async () => {
    const invalidProducts = [
      {
        name: { en_US: 'Invalid Product' },
        // missing 'active' and 'productType'
      },
    ];

    await expect(
      liferayService.createProductsBatch(config, invalidProducts)
    ).rejects.toThrow(/Data does not match Liferay API contract/);
  });
});
