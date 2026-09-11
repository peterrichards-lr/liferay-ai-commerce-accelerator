const ProductGenerator = require('../generators/productGenerator.cjs');
const products = require('../generators/product-steps/products.cjs');
const { COMMERCE_CONSTRAINTS } = require('../utils/commerceConstants.cjs');
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
      resolveByERCsWithRetry: vi
        .fn()
        .mockImplementation(async (cfg, ercs, fetcher) => {
          const res = await fetcher(cfg, ercs);
          return res?.items || res || [];
        }),
      patchPriceList: vi.fn().mockResolvedValue({}),
      patchCatalog: vi.fn().mockResolvedValue({}),
      createPriceEntriesBatch: vi
        .fn()
        .mockResolvedValue({ batchId: 'batch-pe-1' }),
      createPriceEntry: vi.fn().mockResolvedValue({ id: 'pe-1' }),
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
        stepWarning: vi.fn(),
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

  describe('Workflow Step: Resolve Product IDs', () => {
    // A Liferay product carries two ids: `id` is the CProduct, `productId` the
    // CPDefinition. Every product-scoped path takes the definition id, and
    // this step used to ask for `id` alone - so the definition id was never
    // fetched, the option read-back 404ed, and every SKU came out inactive
    // (#748).
    const resolveIds = () =>
      productGenerator.steps[WORKFLOW_STEPS.RESOLVE_PRODUCT_IDS]('sess-123');

    beforeEach(() => {
      mockLiferay.getProductsByERC.mockResolvedValue({
        items: [{ id: 41289, productId: 41290, externalReferenceCode: 'ERC1' }],
      });
    });

    it('asks Liferay for the definition id, not just the CProduct id', async () => {
      await resolveIds();

      expect(mockLiferay.getProductsByERC).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.arrayContaining(['id', 'productId', 'externalReferenceCode'])
      );
    });

    it('stores both ids under names that say which is which', async () => {
      await resolveIds();

      const [[, patch]] = mockPersistence.updateSessionContext.mock.calls;
      const [product] = patch.productDataList;

      expect(product.cProductId).toBe(41289);
      expect(product.cpDefinitionId).toBe(41290);
    });

    it('warns when Liferay resolved a product without a definition id', async () => {
      // Without it the next steps read an empty or missing product rather than
      // failing, so the cause has to be reported where it is still visible.
      mockLiferay.getProductsByERC.mockResolvedValue({
        items: [{ id: 41289, externalReferenceCode: 'ERC1' }],
      });

      await resolveIds();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('without a definition id'),
        expect.anything()
      );
    });
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

      expect(mockLiferay.createPriceEntry).toHaveBeenCalled();
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

    // The create payload carries no tax configuration at all. It used to carry
    // it on the first product of a run, on the reading that Liferay stored it
    // once for the catalogue - `productTaxConfiguration.id` came back 0 on
    // every product, which looked like "no per-product row".
    //
    // Measured against a live 2026.q3.0 instance, that reading was wrong:
    // PATCH one product to `taxable: false` and the next still reads `true`.
    // The id is simply not populated in the response. So the old behaviour
    // configured one product and left the rest on Liferay's default, silently.
    //
    // It cannot move into the create payload either - that is what raced on
    // CPConfigurationEntrySetting and discarded whole batches (#695, #667).
    // It is applied after the products exist instead. See #714.
    const taxCarrying = () =>
      sentPayloads().filter(
        (p) => p.productConfiguration?.productTaxConfiguration
      );

    it('sends no tax configuration with the products themselves', async () => {
      mockSession.context.productDataList = Array.from({ length: 5 }, (_, i) =>
        productFixture(i)
      );

      await productGenerator.steps[WORKFLOW_STEPS.CREATE_PRODUCTS]('sess-123');

      expect(sentPayloads()).toHaveLength(5);
      // Sending it here is what raced; sending it on one product is what left
      // four products misconfigured. Neither belongs in this payload.
      expect(taxCarrying()).toHaveLength(0);
    });

    it('sends the per-product fields on every product', async () => {
      // Keyed to the product, so withholding these would leave 49 products
      // without a setting the run asked for.
      mockSession.context.productDataList = Array.from({ length: 5 }, (_, i) =>
        productFixture(i)
      );

      await productGenerator.steps[WORKFLOW_STEPS.CREATE_PRODUCTS]('sess-123');

      const payloads = sentPayloads();

      expect(payloads.filter((p) => p.productConfiguration)).toHaveLength(5);
      payloads.forEach((p) =>
        expect(p.productConfiguration.allowBackOrder).toBe(false)
      );
    });

    it('applies the tax configuration to every product, not to one', async () => {
      const patched = [];

      mockLiferay.client = {
        headlessCommerceAdminCatalog: {
          v1_0: {
            patchProductByExternalReferenceCode: async (_config, erc, data) => {
              patched.push({ data, erc });
              return {};
            },
          },
        },
      };

      const ercs = ['ERC1', 'ERC2', 'ERC3'];

      await products.applyProductTaxConfiguration.call(
        {
          liferay: mockLiferay,
          logger: mockLogger,
        },
        {
          config: mockSession.context.config,
          externalReferenceCodes: ercs,
          sessionId: 'sess-123',
        }
      );

      expect(patched.map((p) => p.erc)).toEqual(ercs);
      patched.forEach(({ data }) =>
        expect(data.productConfiguration.productTaxConfiguration).toEqual({
          taxCategory: 'Standard',
          taxable: true,
        })
      );
    });

    it('lets one product keep its default rather than failing the run', async () => {
      // #892's rule, applied here: a rejected entity is recorded and stepped
      // over. A product with the default tax treatment is worth more than a
      // run that stopped.
      const patched = [];

      mockLiferay.client = {
        headlessCommerceAdminCatalog: {
          v1_0: {
            patchProductByExternalReferenceCode: async (_config, erc) => {
              if (erc === 'ERC2') {
                throw new Error('HTTP 400: nope');
              }
              patched.push(erc);
              return {};
            },
          },
        },
      };

      const result = await products.applyProductTaxConfiguration.call(
        { liferay: mockLiferay, logger: mockLogger },
        {
          config: mockSession.context.config,
          externalReferenceCodes: ['ERC1', 'ERC2', 'ERC3'],
          sessionId: 'sess-123',
        }
      );

      expect(patched).toEqual(['ERC1', 'ERC3']);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].subject).toBe('ERC2');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('kept the default tax configuration'),
        expect.anything()
      );
    });

    it('says so rather than failing when the client cannot patch', async () => {
      const result = await products.applyProductTaxConfiguration.call(
        { liferay: { client: {} }, logger: mockLogger },
        {
          config: mockSession.context.config,
          externalReferenceCodes: ['ERC1'],
          sessionId: 'sess-123',
        }
      );

      expect(result).toEqual({ failures: [], written: 0 });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('patchProductByExternalReferenceCode'),
        expect.anything()
      );
    });
  });

  describe("Liferay's SKU contributor rule (regression)", () => {
    // CPOptionLocalServiceImpl._validateCommerceOptionTypeKey swaps in
    // CPConstants.PRODUCT_OPTION_SKU_CONTRIBUTOR_FIELD_TYPES - select,
    // select_date, radio - whenever skuContributor is set, and throws
    // CPOptionSKUContributorException for anything else. That surfaces as a
    // bare "Failed to create option" and took the whole step down. Our own
    // constant wrongly included checkbox and checkbox_multiple, and nothing
    // compared the field type against the flag in any case.
    const optionFrom = (option) => {
      mockSession.context.productDataList = [
        {
          externalReferenceCode: 'ERC1',
          name: { en_US: 'Product 1' },
          description: { en_US: 'd' },
          productOptions: [option],
        },
      ];
    };

    const sentOption = () =>
      mockLiferay.createOptionWithReuse.mock.calls.at(-1)?.[1];

    it('corrects a contributing option the platform would reject', async () => {
      optionFrom({
        key: 'size',
        name: 'Size',
        fieldType: 'checkbox',
        skuContributor: true,
        values: ['S', 'M'],
      });

      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_OPTIONS]('sess-123');

      const sent = sentOption();
      expect(sent.skuContributor).toBe(true);
      expect(COMMERCE_CONSTRAINTS.SKU_CONTRIBUTOR_FIELD_TYPES).toContain(
        sent.fieldType
      );
    });

    it('leaves an already valid contributing option alone', async () => {
      optionFrom({
        key: 'colour',
        name: 'Colour',
        fieldType: 'radio',
        skuContributor: true,
        values: ['Red'],
      });

      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_OPTIONS]('sess-123');

      expect(sentOption().fieldType).toBe('radio');
      expect(sentOption().skuContributor).toBe(true);
    });

    it('stops an option with no values from claiming to define variants', async () => {
      // Nothing to vary on, so the flag cannot be honoured whatever the type.
      optionFrom({
        key: 'engraving',
        name: 'Engraving',
        fieldType: 'text',
        skuContributor: true,
        values: [],
      });

      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_OPTIONS]('sess-123');

      expect(sentOption().skuContributor).toBe(false);
      expect(sentOption().fieldType).toBe('text');
    });

    it('never sends a field type outside the OpenAPI list', async () => {
      optionFrom({
        key: 'mystery',
        name: 'Mystery',
        fieldType: 'not_a_real_type',
        skuContributor: false,
        values: [],
      });

      await productGenerator.steps[WORKFLOW_STEPS.ENSURE_OPTIONS]('sess-123');

      expect(COMMERCE_CONSTRAINTS.VALID_FIELD_TYPES).toContain(
        sentOption().fieldType
      );
    });
  });
});
