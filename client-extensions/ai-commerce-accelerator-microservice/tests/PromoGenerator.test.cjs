const { PromoGenerator } = require('../generators/PromoGenerator.cjs');
const MockDataGenerator = require('../generators/mockDataGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');
const { GenerationFacade } = require('../services/generationFacade.cjs');

describe('PromoGenerator', () => {
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
      },
      // Promo generation goes through GenerationFacade like every other
      // entity, so demo mode can substitute the mock for the model. See #697.
      generation: {
        generateData: vi.fn().mockResolvedValue({
          userSegments: [
            {
              name: 'Gold B2B Customers',
              description: 'High volume wholesale buyers',
              externalReferenceCode: 'SEG-GOLD-BUYERS',
            },
          ],
          promotions: [
            {
              name: '15% Off Hand Tools',
              description: 'Promo for gold B2B buyers',
              discountPercentage: 15,
              targetSegmentName: 'Gold B2B Customers',
              externalReferenceCode: 'PROMO-GOLD-15',
            },
          ],
        }),
      },
      liferay: {
        getProducts: vi.fn().mockResolvedValue({
          items: [{ name: 'Hammer', sku: 'SKU-HAMMER', id: 100 }],
        }),
        getAccounts: vi.fn().mockResolvedValue({
          items: [
            {
              name: 'Wholesale Inc',
              externalReferenceCode: 'ACC-WHOLESALE',
              id: 200,
            },
          ],
        }),
        getCatalogs: vi.fn().mockResolvedValue({
          items: [{ name: 'Master Catalog', id: 300 }],
        }),
        createAccountGroup: vi.fn().mockResolvedValue({ id: 400 }),
        getAccountGroupByERC: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ id: 400 }),
        getPriceListByERC: vi.fn().mockResolvedValue(null),
        assignAccountToGroup: vi.fn().mockResolvedValue({}),
        createPriceList: vi.fn().mockResolvedValue({ id: 500 }),
        createPriceEntriesBatch: vi.fn().mockResolvedValue({ count: 1 }),
        createPriceListAccountGroup: vi.fn().mockResolvedValue({}),
        rest: {
          _post: vi.fn().mockResolvedValue({ id: 1000 }),
        },
      },
      progress: {
        sessionStarted: vi.fn(),
        stepStarted: vi.fn(),
        stepProgress: vi.fn(),
        stepFailed: vi.fn(),
        stepCompleted: vi.fn(),
        sessionCompleted: vi.fn(),
      },
      batchCallback: {
        _checkSessionCompletion: vi.fn(),
      },
    };

    generator = new PromoGenerator(mockCtx);
  });

  it('should run workflow steps sequentially', async () => {
    const sessionId = 'session-123';
    await persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      currentSteps: [],
      context: {
        config: { siteGroupId: 123 },
        options: { generatePromotions: true, productCount: 1, accountCount: 1 },
        accountDataList: [
          {
            name: 'Wholesale Inc',
            externalReferenceCode: 'ACC-WHOLESALE',
            id: 200,
          },
        ],
        productDataList: [{ name: 'Hammer', sku: 'SKU-HAMMER', id: 100 }],
      },
    });

    const config = { siteGroupId: 123 };

    await generator._runPromoDataGenerationStep(sessionId);
    await generator._runCreateUserSegmentsStep(sessionId);
    await generator._runCreatePromotionsStep(sessionId);

    const session = await persistence.getSession(sessionId);
    expect(session.context.userSegmentsDataList.length).toBe(1);
    expect(session.context.promotionsDataList.length).toBe(1);

    expect(mockCtx.liferay.createAccountGroup).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        name: 'Gold B2B Customers',
        externalReferenceCode: 'SEG-GOLD-BUYERS',
      })
    );

    expect(mockCtx.liferay.assignAccountToGroup).toHaveBeenCalledWith(
      config,
      'SEG-GOLD-BUYERS',
      'ACC-WHOLESALE'
    );

    expect(mockCtx.liferay.createPriceList).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        name: '15% Off Hand Tools',
        type: 'promotion',
      })
    );

    expect(mockCtx.liferay.createPriceListAccountGroup).toHaveBeenCalledWith(
      config,
      'PROMO-GOLD-15',
      {
        priceListId: 500,
        accountGroupId: 400,
        accountGroupExternalReferenceCode: 'SEG-GOLD-BUYERS',
      }
    );
  });

  // Pricing v2.0 declares skuId required and int64, and the pricing step's own
  // comment records the cost of getting it wrong: "Pricing V2.0 will crash the
  // entire batch if one ID is invalid." This used to send product.id - a
  // CProduct id, not a SKU id and not even the id product-scoped paths take
  // (#748) - whenever a product had no resolved SKU (#778).
  const runPromoFlow = async (sessionId, productDataList) => {
    await persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      currentSteps: [],
      context: {
        config: { siteGroupId: 123 },
        options: { generatePromotions: true, productCount: 1, accountCount: 1 },
        accountDataList: [
          {
            name: 'Wholesale Inc',
            externalReferenceCode: 'ACC-WHOLESALE',
            id: 200,
          },
        ],
        productDataList,
      },
    });

    await generator._runPromoDataGenerationStep(sessionId);
    await generator._runCreateUserSegmentsStep(sessionId);
    await generator._runCreatePromotionsStep(sessionId);
  };

  it('writes no promotional price entry for a product with no resolved SKU', async () => {
    await runPromoFlow('session-no-sku', [
      {
        name: 'Hammer',
        sku: 'SKU-HAMMER',
        externalReferenceCode: 'AICA-PRD-HAMMER',
        cProductId: 100,
      },
    ]);

    const entries = mockCtx.liferay.createPriceEntriesBatch.mock.calls.flatMap(
      ([, batch]) => batch || []
    );

    expect(entries).toHaveLength(0);
    expect(mockCtx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no SKU resolved to price'),
      expect.anything()
    );
  });

  it('never sends a product id in the skuId field', async () => {
    await runPromoFlow('session-guard', [
      {
        name: 'Hammer',
        sku: 'SKU-HAMMER',
        externalReferenceCode: 'AICA-PRD-HAMMER',
        cProductId: 100,
        cpDefinitionId: 101,
      },
    ]);

    const entries = mockCtx.liferay.createPriceEntriesBatch.mock.calls.flatMap(
      ([, batch]) => batch || []
    );

    for (const entry of entries) {
      expect(entry.skuId).not.toBe(100);
      expect(entry.skuId).not.toBe(101);
    }
  });

  it('prices a SKU that did resolve, using the SKU own id', async () => {
    await runPromoFlow('session-with-sku', [
      {
        name: 'Hammer',
        sku: 'SKU-HAMMER',
        externalReferenceCode: 'AICA-PRD-HAMMER',
        cProductId: 100,
        skus: [{ id: 9001, sku: 'SKU-HAMMER', price: 20 }],
      },
    ]);

    const entries = mockCtx.liferay.createPriceEntriesBatch.mock.calls.flatMap(
      ([, batch]) => batch || []
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.skuId).toBe(9001);
    }
  });

  it('does not crash when the AI returns a segment/promotion with no name', async () => {
    mockCtx.generation.generateData.mockResolvedValue({
      userSegments: [
        {
          name: '',
          description: 'Unnamed segment',
          externalReferenceCode: 'SEG-UNNAMED',
        },
      ],
      promotions: [
        {
          name: '10% Off Everything',
          description: 'Promo with no target segment name',
          discountPercentage: 10,
          targetSegmentName: undefined,
          externalReferenceCode: 'PROMO-UNNAMED',
        },
      ],
    });

    const sessionId = 'session-456';
    await persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      currentSteps: [],
      context: {
        config: { siteGroupId: 123 },
        options: { generatePromotions: true, productCount: 1, accountCount: 1 },
        accountDataList: [
          {
            name: 'Wholesale Inc',
            externalReferenceCode: 'ACC-WHOLESALE',
            id: 200,
          },
        ],
        productDataList: [{ name: 'Hammer', sku: 'SKU-HAMMER', id: 100 }],
      },
    });

    await expect(
      generator._runPromoDataGenerationStep(sessionId)
    ).resolves.not.toThrow();

    const session = await persistence.getSession(sessionId);
    expect(session.context.promotionsDataList[0].targetSegmentERC).toBe(
      'SEG-UNNAMED'
    );
  });

  // This was the one generation path with no demo-mode substitution: it called
  // `ctx.ai` directly, so the mode that exists to cost nothing still made a
  // model call. A real facade rather than a stub, because the substitution is
  // the facade's job and stubbing it would assert nothing. See #697.
  it('never reaches the AI service in demo mode', async () => {
    const ai = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(
            `demo mode called the AI service: ${String(property)}`
          );
        },
      }
    );

    mockCtx.ai = ai;
    mockCtx.mockDataGenerator = new MockDataGenerator(mockCtx);
    mockCtx.generation = new GenerationFacade(mockCtx);

    const sessionId = 'session-789';
    await persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      currentSteps: [],
      context: {
        config: { siteGroupId: 123 },
        options: { demoMode: true, generatePromotions: true },
        accountDataList: [
          {
            name: 'Wholesale Inc',
            externalReferenceCode: 'ACC-WHOLESALE',
            id: 200,
          },
        ],
        productDataList: [{ name: 'Hammer', sku: 'SKU-HAMMER', id: 100 }],
      },
    });

    await generator._runPromoDataGenerationStep(sessionId);

    const session = await persistence.getSession(sessionId);
    expect(session.context.userSegmentsDataList.length).toBeGreaterThan(0);
    expect(session.context.promotionsDataList.length).toBeGreaterThan(0);
  });
});
