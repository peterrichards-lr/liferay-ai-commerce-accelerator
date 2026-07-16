const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

describe('ProductGenerator Workflow Steps', () => {
  let productGenerator;
  let mockCtx;
  let mockLiferay;
  let mockPersistence;
  let mockLogger;
  let mockSession;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLiferay = {
      createSpecificationWithReuse: vi.fn().mockResolvedValue({
        id: 'spec-123',
        externalReferenceCode: 'spec-erc',
      }),
      createOptionWithReuse: vi
        .fn()
        .mockResolvedValue({ id: 'opt-123', externalReferenceCode: 'opt-erc' }),
      createProductsBatch: vi.fn().mockResolvedValue({ batchId: 'batch-p1' }),
      getProductsByERC: vi.fn().mockResolvedValue({
        items: [{ id: 'p-1', externalReferenceCode: 'ERC1' }],
      }),
      patchPriceList: vi.fn().mockResolvedValue({}),
      patchCatalog: vi.fn().mockResolvedValue({}),
      createPriceEntriesBatch: vi
        .fn()
        .mockResolvedValue({ batchId: 'batch-pe-1' }),
      getPriceListByERC: vi
        .fn()
        .mockResolvedValue({ id: 'pl-123', externalReferenceCode: 'erc-pl' }),
      createPriceList: vi
        .fn()
        .mockResolvedValue({ id: 'pl-123', externalReferenceCode: 'erc-pl' }),
    };

    mockPersistence = {
      getSession: vi.fn(),
      updateSessionContext: vi.fn(),
      createBatch: vi.fn().mockResolvedValue({ id: 'batch-123' }),
      updateBatch: vi.fn().mockResolvedValue({}),
    };

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    };

    mockCtx = {
      liferay: mockLiferay,
      persistence: mockPersistence,
      logger: mockLogger,
      progress: {
        batchStarted: vi.fn(),
        batchCompleted: vi.fn(),
      },
    };

    productGenerator = new ProductGenerator(mockCtx);

    // Mock BaseGenerator helpers inherited by ProductGenerator
    productGenerator.completeSyncStep = vi
      .fn()
      .mockResolvedValue({ status: 'COMPLETED' });
    productGenerator.failSyncStep = vi
      .fn()
      .mockResolvedValue({ status: 'FAILED' });

    mockSession = {
      session_id: 'sess-123',
      correlationId: 'corr-123',
      context: {
        config: { liferayUrl: 'http://localhost:8080', catalogId: '123' },
        productDataList: [
          {
            externalReferenceCode: 'ERC1',
            name: { en_US: 'Product 1' },
            description: { en_US: 'Product 1 Description' },
            productSpecifications: [
              { specificationKey: 'color', value: 'red' },
            ],
            productOptions: [{ optionKey: 'size', values: ['large'] }],
          },
        ],
        defaultSpecificationCategory: 'DefaultCat',
      },
    };
    mockPersistence.getSession.mockResolvedValue(mockSession);
  });

  describe('Workflow Step: Ensure Specifications', () => {
    it('should bypass step if productDataList is empty', async () => {
      mockSession.context.productDataList = [];
      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_SPECIFICATIONS]('sess-123');

      expect(productGenerator.completeSyncStep).toHaveBeenCalledWith(
        'sess-123',
        WORKFLOW_STEPS.ENSURE_SPECIFICATIONS,
        'BYPASSED'
      );
    });

    it('should create specifications and update list on session context', async () => {
      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_SPECIFICATIONS]('sess-123');

      expect(mockLiferay.createSpecificationWithReuse).toHaveBeenCalled();
      expect(productGenerator.completeSyncStep).toHaveBeenCalledWith(
        'sess-123',
        WORKFLOW_STEPS.ENSURE_SPECIFICATIONS,
        'SYNCHRONOUS',
        1,
        1
      );
    });

    it('should fail specifications step and record failure if an error occurs', async () => {
      mockLiferay.createSpecificationWithReuse.mockRejectedValue(
        new Error('Liferay spec API crash')
      );

      await expect(
        productGenerator.steps[WORKFLOW_STEPS.ENSURE_SPECIFICATIONS]('sess-123')
      ).rejects.toThrow('Liferay spec API crash');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed ensure specifications step'),
        expect.any(Object)
      );
    });
  });

  describe('Workflow Step: Ensure Options', () => {
    it('should bypass step if productDataList is empty', async () => {
      mockSession.context.productDataList = [];
      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_OPTIONS]('sess-123');

      expect(productGenerator.completeSyncStep).toHaveBeenCalledWith(
        'sess-123',
        WORKFLOW_STEPS.ENSURE_OPTIONS,
        'BYPASSED'
      );
    });

    it('should create options and update list on session context', async () => {
      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_OPTIONS]('sess-123');

      expect(mockLiferay.createOptionWithReuse).toHaveBeenCalled();
      expect(productGenerator.completeSyncStep).toHaveBeenCalledWith(
        'sess-123',
        WORKFLOW_STEPS.ENSURE_OPTIONS,
        'SYNCHRONOUS',
        1,
        1
      );
    });

    it('should fail options step and record failure if an error occurs', async () => {
      mockLiferay.createOptionWithReuse.mockRejectedValue(
        new Error('Liferay option API crash')
      );

      await expect(
        productGenerator.steps[WORKFLOW_STEPS.ENSURE_OPTIONS]('sess-123')
      ).rejects.toThrow('Liferay option API crash');
    });
  });

  describe('Workflow Step: Create Products', () => {
    it('should create products batch via Liferay Vulcan API', async () => {
      await productGenerator.steps[WORKFLOW_STEPS.CREATE_PRODUCTS]('sess-123');

      expect(mockLiferay.createProductsBatch).toHaveBeenCalled();
    });
  });

  describe('Workflow Step: Generate Price Lists', () => {
    it('should trigger pricing step successfully', async () => {
      mockSession.context.productDataList = [
        {
          externalReferenceCode: 'ERC1',
          name: { en_US: 'Product 1' },
          skus: [{ externalReferenceCode: 'SKU1', id: 'sku-123' }],
          priceEntries: [
            {
              skuExternalReferenceCode: 'SKU1',
              price: 99.99,
              promoPrice: 79.99,
            },
          ],
        },
      ];

      await productGenerator.steps[WORKFLOW_STEPS.GENERATE_PRICE_LISTS]('sess-123');

      expect(mockLiferay.createPriceEntriesBatch).toHaveBeenCalled();
    });
  });
});
