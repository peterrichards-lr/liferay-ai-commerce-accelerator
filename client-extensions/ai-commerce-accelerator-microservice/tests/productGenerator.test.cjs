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
      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_SPECIFICATIONS](
        'sess-123'
      );

      expect(productGenerator.completeSyncStep).toHaveBeenCalledWith(
        'sess-123',
        WORKFLOW_STEPS.ENSURE_SPECIFICATIONS,
        'BYPASSED'
      );
    });

    it('should create specifications and update list on session context', async () => {
      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_SPECIFICATIONS](
        'sess-123'
      );

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

  describe('Workflow Step: Sync Delay Pricing', () => {
    it('registers a handler that delegates to the inherited inter-service sync delay step', async () => {
      productGenerator._runInterServiceSyncDelayStep = vi
        .fn()
        .mockResolvedValue();

      await productGenerator.steps[WORKFLOW_STEPS.SYNC_DELAY_PRICING](
        'sess-123'
      );

      expect(
        productGenerator._runInterServiceSyncDelayStep
      ).toHaveBeenCalledWith('sess-123', WORKFLOW_STEPS.SYNC_DELAY_PRICING);
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

      await productGenerator.steps[WORKFLOW_STEPS.GENERATE_PRICE_LISTS](
        'sess-123'
      );

      expect(mockLiferay.createPriceEntriesBatch).toHaveBeenCalled();
    });
  });

  describe('shared product configuration (regression)', () => {
    // Liferay applies productConfiguration to the definition's MASTER
    // configuration entry, and CPConfigurationEntrySetting is keyed by
    // configuration entry, company and group - it has no classNameId or
    // classPK, so it is one shared row rather than a per-product setting.
    // Sending it with every product made every item update that row, and
    // because Liferay's batch engine runs import tasks concurrently those
    // updates raced: "Batch update returned unexpected row count from update
    // [1]; actual row count: 0" discarded an entire batch and halted the
    // workflow. Raising the batch size so everything fitted in one task only
    // moved the threshold; sending it once removes the second writer.
    const productFixture = (i) => ({
      externalReferenceCode: `ERC${i}`,
      name: { en_US: `Product ${i}` },
      description: { en_US: `Description ${i}` },
    });

    const sentPayloads = () =>
      mockLiferay.createProductsBatch.mock.calls.flatMap(([, chunk]) => chunk);

    it('sends the shared configuration on exactly one product', async () => {
      mockSession.context.productDataList = Array.from({ length: 5 }, (_, i) =>
        productFixture(i)
      );

      await productGenerator.steps[WORKFLOW_STEPS.CREATE_PRODUCTS]('sess-123');

      const payloads = sentPayloads();
      expect(payloads).toHaveLength(5);

      const carrying = payloads.filter((p) => p.productConfiguration);
      expect(carrying).toHaveLength(1);
      expect(carrying[0].productConfiguration).toEqual({
        productTaxConfiguration: { taxCategory: 'Standard', taxable: true },
      });
    });

    it('still sends it when there is only one product', async () => {
      mockSession.context.productDataList = [productFixture(0)];

      await productGenerator.steps[WORKFLOW_STEPS.CREATE_PRODUCTS]('sess-123');

      expect(sentPayloads().filter((p) => p.productConfiguration)).toHaveLength(
        1
      );
    });

    it('does not depend on how the products are split into batches', async () => {
      // The guarantee has to hold per run, not per batch: two batches each
      // carrying the configuration would race exactly as before.
      mockSession.context.config.batchSize = 2;
      mockSession.context.productDataList = Array.from({ length: 7 }, (_, i) =>
        productFixture(i)
      );

      await productGenerator.steps[WORKFLOW_STEPS.CREATE_PRODUCTS]('sess-123');

      expect(mockLiferay.createProductsBatch.mock.calls.length).toBeGreaterThan(
        1
      );
      expect(sentPayloads().filter((p) => p.productConfiguration)).toHaveLength(
        1
      );
    });
  });
});
