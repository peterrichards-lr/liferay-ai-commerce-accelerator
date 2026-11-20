const {
  PromoGenerator,
  assignSegmentMembers,
} = require('../generators/PromoGenerator.cjs');
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

  // A second run with no delete in between finds the promotion's price list
  // and segment from the first, and the link between them already exists.
  // That 409 ended the whole session (#1455).
  it('carries on when the promotion is already linked to its segment', async () => {
    const sessionId = 'session-relinked';
    mockCtx.liferay.getPriceListByERC.mockResolvedValue({ id: 500 });
    mockCtx.liferay.createPriceListAccountGroup.mockRejectedValue(
      Object.assign(new Error('Failed to link account group to price list'), {
        status: 409,
      })
    );

    await runPromoFlow(sessionId, [
      {
        name: 'Hammer',
        sku: 'SKU-HAMMER',
        id: 100,
        skus: [{ id: 700, sku: 'SKU-HAMMER' }],
      },
    ]);

    expect(mockCtx.liferay.createPriceList).not.toHaveBeenCalled();
    expect(mockCtx.liferay.createPriceListAccountGroup).toHaveBeenCalledTimes(
      1
    );
    expect(mockCtx.liferay.createPriceEntriesBatch).toHaveBeenCalled();
    expect(mockCtx.progress.stepFailed).not.toHaveBeenCalled();
  });

  it('still fails when linking the promotion to its segment is refused', async () => {
    const sessionId = 'session-link-refused';
    mockCtx.liferay.createPriceListAccountGroup.mockRejectedValue(
      Object.assign(new Error('Failed to link account group to price list'), {
        status: 403,
      })
    );

    await expect(
      runPromoFlow(sessionId, [
        {
          name: 'Hammer',
          sku: 'SKU-HAMMER',
          id: 100,
          skus: [{ id: 700, sku: 'SKU-HAMMER' }],
        },
      ])
    ).rejects.toThrow('Failed to link account group to price list');

    expect(mockCtx.liferay.createPriceEntriesBatch).not.toHaveBeenCalled();
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

  // prompts/promo.md:23 asks the model for the promotion's own reference code,
  // and PromoGenerator caps it at 50 characters. Concatenating that with a SKU
  // code produced up to 90, overrunning the 75 Liferay stores - and the part
  // cut was the SKU tail, the only part telling two entries apart. Two
  // variants then arrived as one code and the second hit the unique index.
  // Liferay reported it and the step still completed. #801.
  it('keeps promotional price entry codes distinct when the promotion code is long', async () => {
    mockCtx.generation.generateData = vi.fn().mockResolvedValue({
      userSegments: [
        {
          name: 'Gold B2B Customers',
          description: 'High volume wholesale buyers',
          externalReferenceCode: 'SEG-GOLD-BUYERS',
        },
      ],
      promotions: [
        {
          name: 'Summer Adventure Touring Clearance',
          description: 'Long descriptive code, as the model tends to produce',
          discountPercentage: 15,
          targetSegmentName: 'Gold B2B Customers',
          // 50 characters: what the cap allows through.
          externalReferenceCode:
            'SUMMER-ADVENTURE-TOURING-CLEARANCE-EVENT-2026-Q3-A',
        },
      ],
    });

    await runPromoFlow('session-long-promo-erc', [
      {
        name: 'Trailmaster Top Case',
        sku: 'TR500-TC',
        externalReferenceCode: 'AICA-PRD-TC',
        cProductId: 100,
        // Variant codes that differ only in the tail, which is what the old
        // scheme truncated away.
        skuVariants: [
          {
            id: 9001,
            sku: 'TR500-TRAILMASTER-TOP-BLK-LOCK',
            externalReferenceCode: 'TR500-TRAILMASTER-TOP-BLK-LOCK',
            price: 20,
          },
          {
            id: 9002,
            sku: 'TR500-TRAILMASTER-TOP-RAWSILVER-LOCK',
            externalReferenceCode: 'TR500-TRAILMASTER-TOP-RAWSILVER-LOCK',
            price: 20,
          },
        ],
      },
    ]);

    const entries = mockCtx.liferay.createPriceEntriesBatch.mock.calls.flatMap(
      ([, batch]) => batch || []
    );

    // Not vacuous: both variants must actually be priced.
    expect(entries.map((e) => e.skuId).sort()).toEqual([9001, 9002]);

    const codes = entries.map((e) => e.externalReferenceCode);
    expect(new Set(codes).size).toBe(2);

    for (const code of codes) {
      expect(code.length).toBeLessThanOrEqual(75);
    }
  });
  /**
   * A failure batch is a row somebody has to be able to read back.
   *
   * These three call sites omitted `erc` entirely, and the SDK's `createBatch`
   * binds what it is given straight into the insert. `workflow_batches.erc` is
   * `TEXT PRIMARY KEY` with no NOT NULL, and SQLite permits NULLs in exactly
   * that shape, so nothing raised - the row was simply written with no
   * identity. `getBatch(erc)` and `updateBatch(erc, ...)` both key on it, so it
   * could be neither looked up nor amended, and two failures in one session
   * were indistinguishable in the report.
   *
   * The message went the same way. `errorDetails` is not a key `createBatch`
   * reads, so the one thing the row existed to record was dropped in silence -
   * the third instance of that class of drop after #172 and #763 (#862).
   */
  describe('a failed promotion step writes a batch that can be read back', () => {
    const seedSession = async (sessionId) => {
      await persistence.createSession({
        sessionId,
        flowType: 'generate',
        status: 'STARTED',
        currentSteps: [],
        context: {
          config: { siteGroupId: 123 },
          options: {
            generatePromotions: true,
            productCount: 1,
            accountCount: 1,
          },
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
    };

    const failedBatches = async (sessionId) =>
      (await persistence.getBatchesForSession(sessionId)).filter(
        (batch) => batch.status === 'FAILED'
      );

    it('records the generation step failure against an ERC of its own', async () => {
      const sessionId = 'session-promo-data-failed';
      await seedSession(sessionId);
      mockCtx.generation.generateData.mockRejectedValue(
        new Error('the model returned no promotions')
      );

      await expect(
        generator._runPromoDataGenerationStep(sessionId)
      ).rejects.toThrow('the model returned no promotions');

      const batches = await failedBatches(sessionId);
      expect(batches).toHaveLength(1);
      expect(batches[0].erc).toMatch(/^AICA-BATCH/);
      expect(batches[0].step_key).toBe('generate-promo-data');
      expect(batches[0].status_reason).toBe('the model returned no promotions');
      expect(await persistence.getBatch(batches[0].erc)).toMatchObject({
        status: 'FAILED',
      });
    });

    it('records the segment step failure against an ERC of its own', async () => {
      const sessionId = 'session-segments-failed';
      await seedSession(sessionId);
      await generator._runPromoDataGenerationStep(sessionId);
      // Reset first: the shared mock queues a one-time null so the happy path
      // creates the group, and a queued value outranks the default.
      mockCtx.liferay.getAccountGroupByERC.mockReset();
      mockCtx.liferay.getAccountGroupByERC.mockRejectedValue(
        new Error('Liferay refused the account group')
      );

      await expect(
        generator._runCreateUserSegmentsStep(sessionId)
      ).rejects.toThrow('Liferay refused the account group');

      const batches = await failedBatches(sessionId);
      expect(batches).toHaveLength(1);
      expect(batches[0].erc).toMatch(/^AICA-BATCH/);
      expect(batches[0].step_key).toBe('create-user-segments');
      expect(batches[0].status_reason).toBe(
        'Liferay refused the account group'
      );
    });

    it('records the promotion step failure against an ERC of its own', async () => {
      const sessionId = 'session-promotions-failed';
      await seedSession(sessionId);
      await generator._runPromoDataGenerationStep(sessionId);
      mockCtx.liferay.getCatalogs.mockRejectedValue(
        new Error('Liferay refused the catalogue lookup')
      );

      await expect(
        generator._runCreatePromotionsStep(sessionId)
      ).rejects.toThrow('Liferay refused the catalogue lookup');

      const batches = await failedBatches(sessionId);
      expect(batches).toHaveLength(1);
      expect(batches[0].erc).toMatch(/^AICA-BATCH/);
      expect(batches[0].step_key).toBe('create-promotions');
      expect(batches[0].status_reason).toBe(
        'Liferay refused the catalogue lookup'
      );
    });

    // Two rows written in one session are two rows, not one row overwritten
    // and one unaddressable.
    it('gives two failures in one session two distinct ERCs', async () => {
      const sessionId = 'session-two-failures';
      await seedSession(sessionId);
      await generator._runPromoDataGenerationStep(sessionId);
      mockCtx.liferay.getAccountGroupByERC.mockReset();
      mockCtx.liferay.getAccountGroupByERC.mockRejectedValue(
        new Error('first')
      );
      mockCtx.liferay.getCatalogs.mockRejectedValue(new Error('second'));

      await expect(
        generator._runCreateUserSegmentsStep(sessionId)
      ).rejects.toThrow('first');
      await expect(
        generator._runCreatePromotionsStep(sessionId)
      ).rejects.toThrow('second');

      const batches = await failedBatches(sessionId);
      expect(batches).toHaveLength(2);
      batches.forEach((batch) => expect(batch.erc).toMatch(/^AICA-BATCH/));
      expect(new Set(batches.map((batch) => batch.erc)).size).toBe(2);
      expect(batches.map((batch) => batch.status_reason).sort()).toEqual([
        'first',
        'second',
      ]);
    });
  });

  // Every segment took accounts.slice(0, 2), so every segment held the same
  // two customers and every promotion priced for the same pair. See #1473.
  describe('segment membership (#1473)', () => {
    const accounts = ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => ({
      name: `Account ${letter}`,
      externalReferenceCode: `ACC-${letter}`,
    }));
    const segments = ['Frequent', 'Volume', 'New'].map((name) => ({
      name,
      externalReferenceCode: `SEG-${name.toUpperCase()}`,
    }));
    const ercs = (membership) =>
      membership.map(({ members }) =>
        members.map((acc) => acc.externalReferenceCode)
      );

    it('gives each segment different, non-empty members', () => {
      const membership = ercs(assignSegmentMembers(segments, accounts));

      expect(membership).toEqual([
        ['ACC-A', 'ACC-B'],
        ['ACC-C', 'ACC-D'],
        ['ACC-E', 'ACC-F'],
      ]);
    });

    it('keeps each segment with its own members', () => {
      expect(
        assignSegmentMembers(segments, accounts).map(({ segment }) => segment)
      ).toEqual(segments);
    });

    it('gives the same membership for the same inputs', () => {
      expect(ercs(assignSegmentMembers(segments, accounts))).toEqual(
        ercs(assignSegmentMembers(segments, accounts))
      );
    });

    it('wraps round rather than leaving a segment empty', () => {
      const membership = ercs(
        assignSegmentMembers(segments, accounts.slice(0, 3))
      );

      expect(membership).toEqual([
        ['ACC-A', 'ACC-B'],
        ['ACC-C', 'ACC-A'],
        ['ACC-B', 'ACC-C'],
      ]);
    });

    it('puts a single account in every segment', () => {
      expect(
        ercs(assignSegmentMembers(segments, accounts.slice(0, 1)))
      ).toEqual([['ACC-A'], ['ACC-A'], ['ACC-A']]);
    });

    it('skips accounts with no ERC, and assigns nobody when none have one', () => {
      const withoutErc = [{ name: 'No ERC' }, ...accounts.slice(0, 2)];

      expect(
        ercs(assignSegmentMembers(segments.slice(0, 1), withoutErc))
      ).toEqual([['ACC-A', 'ACC-B']]);
      expect(
        ercs(assignSegmentMembers(segments, [{ name: 'No ERC' }]))
      ).toEqual([[], [], []]);
      expect(ercs(assignSegmentMembers(segments, undefined))).toEqual([
        [],
        [],
        [],
      ]);
    });

    async function seedSegments(sessionId) {
      await persistence.createSession({
        sessionId,
        flowType: 'generate',
        status: 'STARTED',
        currentSteps: [],
        context: {
          config: { siteGroupId: 123 },
          accountDataList: accounts,
          userSegmentsDataList: segments,
        },
      });
    }

    it('assigns each segment its own accounts in Liferay', async () => {
      const sessionId = 'session-segment-members';
      await seedSegments(sessionId);

      await generator._runCreateUserSegmentsStep(sessionId);

      const calls = mockCtx.liferay.assignAccountToGroup.mock.calls.map(
        ([, group, account]) => `${group}<-${account}`
      );
      expect(calls).toEqual([
        'SEG-FREQUENT<-ACC-A',
        'SEG-FREQUENT<-ACC-B',
        'SEG-VOLUME<-ACC-C',
        'SEG-VOLUME<-ACC-D',
        'SEG-NEW<-ACC-E',
        'SEG-NEW<-ACC-F',
      ]);
    });

    it('treats an account already in the group as assigned on a re-run', async () => {
      const sessionId = 'session-segment-rerun';
      await seedSegments(sessionId);
      mockCtx.liferay.assignAccountToGroup.mockRejectedValue(
        Object.assign(new Error('conflict'), { status: 409 })
      );

      await expect(
        generator._runCreateUserSegmentsStep(sessionId)
      ).resolves.not.toThrow();
      expect(mockCtx.liferay.assignAccountToGroup).toHaveBeenCalledTimes(6);
    });

    it('still fails on any other assignment error', async () => {
      const sessionId = 'session-segment-forbidden';
      await seedSegments(sessionId);
      mockCtx.liferay.assignAccountToGroup.mockRejectedValue(
        Object.assign(new Error('forbidden'), { status: 403 })
      );

      await expect(
        generator._runCreateUserSegmentsStep(sessionId)
      ).rejects.toThrow('forbidden');
    });
  });
});
