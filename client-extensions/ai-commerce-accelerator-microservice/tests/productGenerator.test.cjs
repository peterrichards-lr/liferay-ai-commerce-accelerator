const ProductGenerator = require('../generators/productGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');

describe('ProductGenerator', () => {
  let generator;
  let mockCtx;
  let persistence;

  beforeEach(() => {
    persistence = new PersistenceService(':memory:');

    mockCtx = {
      persistence,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
      generation: {
        generateData: vi.fn().mockResolvedValue([
          {
            name: 'Generated Product',
            externalReferenceCode: 'PROD-1',
            skus: [{ sku: 'SKU-1' }],
            options: [],
          },
        ]),
      },
      liferay: {
        getWarehouses: vi.fn().mockResolvedValue([]),
        createWarehousesBatch: vi
          .fn()
          .mockResolvedValue({ batchId: 'wh-batch' }),
        createProductsBatch: vi
          .fn()
          .mockResolvedValue({ batchId: 'prod-batch' }),
        resolveByERCsWithRetry: vi
          .fn()
          .mockResolvedValue([{ erc: 'PROD-1', id: 2001 }]),
        getImportTask: vi
          .fn()
          .mockResolvedValue({ executeStatus: 'COMPLETED' }),
      },
      progress: {
        sessionStarted: vi.fn(),
        sessionCompleted: vi.fn(),
        sessionFailed: vi.fn(),
        stepStarted: vi.fn(),
        stepProgress: vi.fn(),
        stepCompleted: vi.fn(),
        stepFailed: vi.fn(),
        batchStarted: vi.fn(),
        batchProgress: vi.fn(),
        batchCompleted: vi.fn(),
        batchFailed: vi.fn(),
      },
      batchCallback: {
        _checkSessionCompletion: vi
          .fn()
          .mockImplementation((sid) => generator.executeNextStep(sid)),
      },
    };

    generator = new ProductGenerator(mockCtx);
  });

  afterEach(() => {
    persistence.close();
  });

  it('should start product generation workflow', async () => {
    const config = {
      liferayUrl: 'http://test',
      defaultLanguageId: 'en_US',
      catalogId: '123',
    };
    const options = { productCount: 1, generatePriceLists: true };

    const result = await generator.runWorkflow(config, options);

    expect(result.sessionId).toBeDefined();
    expect(result.message).toContain('started');

    const session = persistence.getSession(result.sessionId);
    expect(session).not.toBeNull();
    // It's actually 'products' in current implementation
    expect(session.flow_type).toBe('products');
    expect(mockCtx.batchCallback._checkSessionCompletion).toHaveBeenCalled();
  });

  it('should run product data generation step', async () => {
    const sessionId = 'prod-test-session';
    persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      context: {
        config: { catalogId: '123' },
        options: { productCount: 1 },
      },
    });

    // We need to mock _generateProductData as it is called by _runProductDataGenerationStep
    generator._generateProductData = vi
      .fn()
      .mockResolvedValue([{ name: 'Generated Product' }]);

    await generator._runProductDataGenerationStep(sessionId);

    const session = persistence.getSession(sessionId);
    expect(session.context.productDataList).toHaveLength(1);
    expect(session.context.productDataList[0].name).toBe('Generated Product');
  });

  it('should handle product creation step', async () => {
    const sessionId = 'test-session';
    persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      context: {
        config: { catalogId: '123' },
        options: { productCount: 1 },
        productDataList: [
          {
            name: 'Test Product',
            description: 'Test Description',
            externalReferenceCode: 'T1',
            skus: [{ sku: 'S1' }],
          },
        ],
      },
    });

    await generator._runProductCreationStep(sessionId);

    // Should have created a batch
    const batches = persistence.getBatchesForSession(sessionId);
    expect(batches.length).toBeGreaterThan(0);
    expect(mockCtx.liferay.createProductsBatch).toHaveBeenCalled();
  });

  it('should run update inventory step and set backorders properties if enableBackorders is active', async () => {
    const sessionId = 'test-inventory-session';
    persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      context: {
        config: { catalogId: '123' },
        options: {
          inventoryMin: 50,
          inventoryMax: 100,
          enableBackorders: true,
          backorderAssignmentRatio: 100,
        },
        productDataList: [
          {
            name: 'Test Product',
            skus: [{ sku: 'SKU-BACKORDER' }],
          },
        ],
        warehouseDataList: [{ id: 'wh-1', name: 'Warehouse 1' }],
      },
    });

    generator.submitBatch = vi.fn().mockResolvedValue({});
    generator.liferay.getWarehouses = vi.fn().mockResolvedValue({
      items: [{ id: 'wh-1', name: 'Warehouse 1' }],
    });
    generator.liferay.rest = {
      _post: vi.fn().mockResolvedValue({}),
    };

    await generator._runUpdateInventoryStep(sessionId);

    const submitBatchArgs = generator.submitBatch.mock.calls[0];
    const callback = submitBatchArgs[4];
    await callback('erc-test');

    const postCalls = generator.liferay.rest._post.mock.calls;
    expect(postCalls[0][2]).toEqual(
      expect.objectContaining({
        sku: 'SKU-BACKORDER',
        backorderable: true,
        backorderLimit: 100,
      })
    );
  });
});
