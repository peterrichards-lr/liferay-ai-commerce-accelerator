const { PromoGenerator } = require('../generators/PromoGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');

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
      ai: {
        generatePromoData: vi.fn().mockResolvedValue({
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
});
