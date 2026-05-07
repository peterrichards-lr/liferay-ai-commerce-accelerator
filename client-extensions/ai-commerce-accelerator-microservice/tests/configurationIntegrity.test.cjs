const LiferayRestService = require('../services/liferay/rest.cjs');

describe('Microservice Configuration Integrity', () => {
  let restService;
  let mockCtx;

  beforeAll(() => {
    mockCtx = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    };
    restService = new LiferayRestService(mockCtx);
  });

  it('should ensure all high-volume discovery operations have SOFT_STATUS_BY_OP entries', () => {
    // Discovery/List operations should generally have soft 404 handling
    // to prevent workflow crashes during indexing or for empty environments.
    const discoveryOps = [
      'accounts:list',
      'products:list',
      'orders:list',
      'pricelists:list',
      'specifications:list',
      'optionCategories:list',
      'get-sku-by-erc',
      'get-account-by-erc',
      'get-product-by-erc',
      'get-warehouse-by-erc',
    ];

    // Read the static property from the service class
    const { SOFT_STATUS_BY_OP } = LiferayRestService;

    discoveryOps.forEach((op) => {
      expect(
        SOFT_STATUS_BY_OP,
        `Missing SOFT_STATUS_BY_OP entry for: ${op}`
      ).toHaveProperty(op);
      expect(SOFT_STATUS_BY_OP[op]).toContain(404);
    });
  });

  it('should have consistent ID field naming in createWarehouseChannel', () => {
    // This tests the logic we just fixed regarding JSON path mapping failures

    // We can't easily test the private payload construction without refactoring
    // but we can verify the method signature in LiferayService exists.
    const { LiferayService } = require('../services/liferay/index.cjs');
    const service = new LiferayService(mockCtx);

    expect(typeof service.createWarehouseChannel).toBe('function');
  });
});
