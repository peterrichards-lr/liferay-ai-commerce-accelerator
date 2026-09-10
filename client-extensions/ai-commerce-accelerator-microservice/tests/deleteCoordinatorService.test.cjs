const DeleteCoordinatorService = require('../services/deleteCoordinatorService.cjs');
const PersistenceService = require('../services/persistenceService.cjs');
const {
  AICA_OWNED,
  EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
} = require('../utils/ownershipScope.cjs');

describe('DeleteCoordinatorService', () => {
  let coordinator;
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
      liferay: {
        getOrders: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
        getAccounts: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
        getAccountGroups: vi
          .fn()
          .mockResolvedValue({ items: [], totalCount: 0 }),
        getProducts: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
        getWarehouses: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
        getAllWarehouseItems: vi
          .fn()
          .mockResolvedValue({ items: [], totalCount: 0 }),
        getSpecifications: vi
          .fn()
          .mockResolvedValue({ items: [], totalCount: 0 }),
        getOptions: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
        getPriceLists: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
        getPromotions: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
        getOptionCategories: vi
          .fn()
          .mockResolvedValue({ items: [], totalCount: 0 }),
        getCatalogs: vi.fn().mockResolvedValue([]),
        // Without these the association sweeps fail on a missing function,
        // are caught by their own warn, and every assertion about the ids
        // they addressed passes vacuously.
        getProductOptions: vi.fn().mockResolvedValue([]),
        getProductSpecifications: vi.fn().mockResolvedValue([]),
        deleteProductOption: vi.fn().mockResolvedValue({}),
        deleteProductSpecification: vi.fn().mockResolvedValue({}),
        getChannels: vi.fn().mockResolvedValue([]),
        _collectAllItems: vi.fn().mockResolvedValue({ items: [] }),
        deleteOrdersBatch: vi.fn().mockResolvedValue({ success: true }),
        deleteAccountsBatch: vi.fn().mockResolvedValue({ success: true }),
        deleteAccountGroupsBatch: vi.fn().mockResolvedValue({ success: true }),
        deleteProductsBatch: vi.fn().mockResolvedValue({ success: true }),
        deleteOptionsBatch: vi
          .fn()
          .mockResolvedValue({ success: true, count: 2 }),
        deleteOptionCategoriesBatch: vi
          .fn()
          .mockResolvedValue({ success: true, count: 1 }),
        deletePromotionsBatch: vi
          .fn()
          .mockResolvedValue({ success: true, count: 2 }),
        patchPriceList: vi.fn().mockResolvedValue({}),
      },
      progress: {
        sessionStarted: vi.fn(),
        stepStarted: vi.fn(),
        stepProgress: vi.fn(),
        stepCompleted: vi.fn(),
        sessionCompleted: vi.fn(),
        sessionFailed: vi.fn(),
      },
      batchCallback: {
        _checkSessionCompletion: vi.fn(),
      },
    };

    coordinator = new DeleteCoordinatorService(mockCtx);
  });

  afterEach(async () => {
    // runDeleteAndMonitor intentionally fires its session-creation write without
    // awaiting it (the whole point is to return the sessionId immediately while
    // the workflow continues in the background). Wait for it to actually drain
    // before closing - a fixed setImmediate/tick delay isn't reliable once other
    // test files' worker threads are competing for CPU.
    const deadline = Date.now() + 2000;
    while (persistence.pendingRequests.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    persistence.close();
  });

  it('should start full deletion workflow with correct name', async () => {
    const config = { correlationId: 'test-cid' };
    const options = {};

    const result = await coordinator.runDeleteAndMonitor(config, options);

    expect(result.sessionId).toBeDefined();
    const session = await persistence.getSession(result.sessionId);
    expect(session.flow_type).toBe('delete');
    expect(session.session_name).toBe('Delete All Commerce Data');
    expect(session.context.generator).toBe('delete');
  });

  it('should start selected deletion workflow with correct name', async () => {
    const config = { correlationId: 'test-cid' };
    const options = {};
    const deleteScope = [{ name: 'deleteOrders' }];

    const result = await coordinator.runDeleteSelectedAndMonitor(
      config,
      options,
      {
        deleteScope,
      }
    );

    expect(result.sessionId).toBeDefined();
    const session = await persistence.getSession(result.sessionId);
    expect(session.flow_type).toBe('delete');
    expect(session.session_name).toBe('Delete Selected Commerce Data');
  });

  it('should run discovery step', async () => {
    const sessionId = 'delete-test-session';
    await persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: ['discover'],
      context: {
        config: { correlationId: 'test-cid' },
        options: {},
        isTotal: true,
        steps: [{ name: 'discover' }],
      },
    });

    await coordinator._runDiscoveryStep(sessionId);

    const session = await persistence.getSession(sessionId);
    expect(session.context.manifest).toBeDefined();

    // Verify totals were emitted for core entities
    expect(mockCtx.progress.stepProgress).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'products', totalCount: 0 })
    );
    expect(mockCtx.progress.stepProgress).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'orders', totalCount: 0 })
    );
  });

  it('should handle order deletion step', async () => {
    const sessionId = 'test-session';
    await persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: ['delete-orders'],
      context: {
        config: {},
        options: {},
        steps: [{ name: 'delete-orders' }],
        manifest: { orders: [{ id: 1, externalReferenceCode: 'AICA-O1' }] },
      },
    });

    await coordinator._runGenericDeletionStep('deleteOrders', sessionId);

    expect(mockCtx.liferay.deleteOrdersBatch).toHaveBeenCalled();
  });

  describe('association steps receive products (regression)', () => {
    // delete-product-specifications and delete-product-options detach a
    // PRODUCT's associations, so they iterate products and call
    // getProductSpecifications / getProductOptions with a product id. They
    // were handed the specification and option definition lists instead, so
    // every lookup 404'd and the step reported COMPLETED having detached
    // nothing. The symptom was a run of warnings naming "products" whose ids
    // were actually specification and option ids.
    const seedSession = async (sessionId, step) => {
      await persistence.createSession({
        sessionId,
        flowType: 'delete',
        status: 'STARTED',
        currentSteps: [step],
        context: {
          config: {},
          options: {},
          steps: [{ name: step }],
          manifest: {
            products: [{ id: 5001 }, { id: 5002 }],
            specifications: [{ id: 44487 }, { id: 44488 }],
            options: [{ id: 44504 }],
          },
        },
      });
    };

    it('clears specifications using product ids, not specification ids', async () => {
      await seedSession('sess-spec', 'delete-product-specifications');

      await coordinator._runGenericDeletionStep(
        'deleteProductSpecifications',
        'sess-spec'
      );

      const ids = (
        mockCtx.liferay.getProductSpecifications?.mock?.calls || []
      ).map(([, id]) => id);

      if (ids.length) {
        expect(ids).toEqual(expect.arrayContaining([5001, 5002]));
        expect(ids).not.toEqual(expect.arrayContaining([44487]));
      }
    });

    it('clears options using product ids, not option ids', async () => {
      await seedSession('sess-opt', 'delete-product-options');

      await coordinator._runGenericDeletionStep(
        'deleteProductOptions',
        'sess-opt'
      );

      const ids = (mockCtx.liferay.getProductOptions?.mock?.calls || []).map(
        ([, id]) => id
      );

      if (ids.length) {
        expect(ids).toEqual(expect.arrayContaining([5001, 5002]));
        expect(ids).not.toEqual(expect.arrayContaining([44504]));
      }
    });

    it('addresses the definition id when the DTO carries both', async () => {
      // Manifest products are crawled Liferay DTOs: `id` is the CProduct and
      // `productId` the CPDefinition. Only the definition id resolves a
      // product-scoped path (#757).
      await persistence.createSession({
        sessionId: 'sess-both',
        flowType: 'delete',
        status: 'STARTED',
        currentSteps: ['delete-product-options'],
        context: {
          config: {},
          options: {},
          steps: [{ name: 'delete-product-options' }],
          manifest: { products: [{ id: 41289, productId: 41290 }] },
        },
      });

      await coordinator._runGenericDeletionStep(
        'deleteProductOptions',
        'sess-both'
      );

      const ids = mockCtx.liferay.getProductOptions.mock.calls.map(
        ([, id]) => id
      );

      expect(ids).toEqual([41290]);
    });
  });

  describe('an empty manifest entry is not proof of absence (#657)', () => {
    const seedSession = async (
      sessionId,
      step,
      { manifest, isTotal, ownershipScope }
    ) => {
      await persistence.createSession({
        sessionId,
        flowType: 'delete',
        status: 'STARTED',
        currentSteps: [step],
        context: {
          config: {},
          options: {},
          catalogId: 77,
          steps: [{ name: step }],
          isTotal,
          manifest,
          ownershipScope,
        },
      });
    };

    const statusFor = async (sessionId, step) => {
      const batches = await persistence.getBatchesForSession(sessionId);
      const stepBatches = batches.filter((b) => b.step_key === step);
      return stepBatches.map((b) => b.status);
    };

    it('deletes options discovery finds when the manifest recorded none', async () => {
      mockCtx.liferay.getOptions.mockResolvedValue({
        items: [
          { id: 1, externalReferenceCode: 'AICA-OPT-COLOUR' },
          { id: 2, externalReferenceCode: 'COLOUR-BY-HAND' },
        ],
        totalCount: 2,
      });

      await seedSession('sess-opt-discovery', 'delete-options', {
        manifest: { options: [] },
        isTotal: true,
      });

      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-opt-discovery'
      );

      expect(mockCtx.liferay.deleteOptionsBatch).toHaveBeenCalled();
      const [, args] = mockCtx.liferay.deleteOptionsBatch.mock.calls[0];
      // The AICA option only. A total run used to take the hand-made one as
      // well, purely because the manifest entry was empty; #858 made that a
      // choice rather than a consequence. The #657 point this test exists for
      // is intact: the step discovered rather than bypassing.
      expect(args.items.map((i) => i.id)).toEqual([1]);
      expect(
        await statusFor('sess-opt-discovery', 'delete-options')
      ).not.toContain('BYPASSED');
    });

    it('still bypasses when Liferay genuinely holds nothing', async () => {
      await seedSession('sess-opt-empty', 'delete-options', {
        manifest: { options: [] },
        isTotal: true,
      });

      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-opt-empty'
      );

      expect(mockCtx.liferay.deleteOptionsBatch).not.toHaveBeenCalled();
      expect(await statusFor('sess-opt-empty', 'delete-options')).toContain(
        'BYPASSED'
      );
    });

    it('leaves the catalog base promotion out of the discovered targets', async () => {
      mockCtx.liferay.getPromotions.mockResolvedValue({
        items: [
          { id: 10, externalReferenceCode: 'PROMO-CROSS-SELL' },
          { id: 11, externalReferenceCode: 'PROMO-BUNDLE' },
          {
            id: 12,
            externalReferenceCode: 'CATALOG-BASE',
            catalogBasePriceList: true,
          },
        ],
        totalCount: 3,
      });

      // Run under the everything scope on purpose. Since #858 the ownership
      // scope would drop the base promotion on its own - it carries no AICA
      // code - and the assertion would pass without the exclusion this test
      // exists to check. Widening the scope leaves the exclusion as the only
      // thing that can keep id 12 out.
      await seedSession('sess-promo-discovery', 'delete-promotions', {
        manifest: { promotions: [] },
        isTotal: true,
        ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id,
      });

      await coordinator._runGenericDeletionStep(
        'deletePromotions',
        'sess-promo-discovery'
      );

      const [, args] = mockCtx.liferay.deletePromotionsBatch.mock.calls[0];
      expect(args.items.map((i) => i.id)).toEqual([10, 11]);
    });

    it('restricts discovery to AICA data when the run is scoped', async () => {
      mockCtx.liferay.getOptions.mockResolvedValue({
        items: [
          { id: 1, externalReferenceCode: 'AICA-OPT-COLOUR' },
          { id: 2, externalReferenceCode: 'COLOUR-BY-HAND' },
        ],
        totalCount: 2,
      });

      await seedSession('sess-opt-scoped', 'delete-options', {
        manifest: { options: [] },
        isTotal: false,
      });

      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-opt-scoped'
      );

      const [, args] = mockCtx.liferay.deleteOptionsBatch.mock.calls[0];
      expect(args.items.map((i) => i.id)).toEqual([1]);
    });

    it('fails the step rather than bypassing when discovery cannot run', async () => {
      mockCtx.liferay.getOptionCategories.mockRejectedValue(
        new Error('503 Service Unavailable')
      );

      await seedSession('sess-cat-error', 'delete-option-categories', {
        manifest: { optionCategories: [] },
        isTotal: true,
      });

      await coordinator._runGenericDeletionStep(
        'deleteOptionCategories',
        'sess-cat-error'
      );

      const statuses = await statusFor(
        'sess-cat-error',
        'delete-option-categories'
      );
      expect(statuses).toContain('FAILED');
      expect(statuses).not.toContain('BYPASSED');
      expect(mockCtx.logger.error).toHaveBeenCalled();
    });
  });

  describe('which entities a run may touch (#850)', () => {
    // One AICA account and one nobody generated. Which of them the crawl keeps
    // is the entire question the ownership scope answers.
    const mixedAccounts = {
      items: [
        { id: 1, externalReferenceCode: 'AICA-ACC-1' },
        { id: 2, externalReferenceCode: 'CUSTOMER-LTD' },
      ],
      totalCount: 2,
    };

    const seedDiscovery = async (sessionId, context = {}) => {
      await persistence.createSession({
        sessionId,
        flowType: 'delete',
        status: 'STARTED',
        currentSteps: ['discover'],
        context: {
          config: { correlationId: 'test-cid' },
          options: {},
          isTotal: true,
          steps: [{ name: 'discover' }],
          ...context,
        },
      });
    };

    it('crawls only AICA-owned data when nothing asked otherwise', async () => {
      mockCtx.liferay.getAccounts.mockResolvedValue(mixedAccounts);

      await seedDiscovery('sess-scope-default');
      await coordinator._runDiscoveryStep('sess-scope-default');

      const session = await persistence.getSession('sess-scope-default');
      expect(session.context.manifest.accounts.map((a) => a.id)).toEqual([1]);
    });

    it('crawls what the default rejects when the run asked for everything', async () => {
      mockCtx.liferay.getAccounts.mockResolvedValue(mixedAccounts);

      await seedDiscovery('sess-scope-everything', {
        ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id,
      });
      await coordinator._runDiscoveryStep('sess-scope-everything');

      const session = await persistence.getSession('sess-scope-everything');
      expect(session.context.manifest.accounts.map((a) => a.id)).toEqual([
        1, 2,
      ]);
    });

    it('still leaves the catalog base price list alone under everything', async () => {
      // The scope says who owns an entity, not whether Liferay will part with
      // it. The base list is refused either way, and counting it as a target
      // would leave the step reporting fewer deletions than it promised.
      mockCtx.liferay.getCatalogs.mockResolvedValue([{ id: 77 }]);
      mockCtx.liferay.getPriceLists.mockResolvedValue({
        items: [
          { id: 20, externalReferenceCode: 'BY-HAND' },
          {
            id: 21,
            externalReferenceCode: 'CATALOG-BASE',
            catalogBasePriceList: true,
          },
        ],
        totalCount: 2,
      });

      await seedDiscovery('sess-scope-base-list', {
        catalogId: 77,
        ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id,
      });
      await coordinator._runDiscoveryStep('sess-scope-base-list');

      const session = await persistence.getSession('sess-scope-base-list');
      expect(session.context.manifest.priceLists.map((p) => p.id)).toEqual([
        20,
      ]);
    });

    it('takes what fallback discovery finds outside AICA only when asked', async () => {
      mockCtx.liferay.getOptions.mockResolvedValue({
        items: [
          { id: 1, externalReferenceCode: 'AICA-OPT-COLOUR' },
          { id: 2, externalReferenceCode: 'COLOUR-BY-HAND' },
        ],
        totalCount: 2,
      });

      const runScoped = async (sessionId, ownershipScope) => {
        await persistence.createSession({
          sessionId,
          flowType: 'delete',
          status: 'STARTED',
          currentSteps: ['delete-options'],
          context: {
            config: {},
            options: {},
            catalogId: 77,
            steps: [{ name: 'delete-options' }],
            // Not a total run: this is where the ownership scope decides,
            // rather than isTotal waving everything through.
            isTotal: false,
            manifest: { options: [] },
            ownershipScope,
          },
        });

        mockCtx.liferay.deleteOptionsBatch.mockClear();
        await coordinator._runGenericDeletionStep('deleteOptions', sessionId);

        const [, args] = mockCtx.liferay.deleteOptionsBatch.mock.calls[0];
        return args.items.map((i) => i.id);
      };

      expect(await runScoped('sess-fallback-default', undefined)).toEqual([1]);
      expect(
        await runScoped(
          'sess-fallback-everything',
          EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id
        )
      ).toEqual([1, 2]);
    });

    describe('starting a run', () => {
      it('records and logs the AICA-owned default', async () => {
        const result = await coordinator.runDeleteAndMonitor(
          { correlationId: 'test-cid' },
          {}
        );

        const session = await persistence.getSession(result.sessionId);
        expect(session.context.ownershipScope).toBe(AICA_OWNED.id);

        // An operator reading the log after the fact has no other way to tell
        // which scope a finished run used.
        expect(mockCtx.logger.info).toHaveBeenCalledWith(
          expect.stringContaining(AICA_OWNED.label),
          expect.objectContaining({ ownershipScope: AICA_OWNED.id })
        );
      });

      it('records and logs everything when the scope object is passed', async () => {
        const result = await coordinator.runDeleteAndMonitor(
          { correlationId: 'test-cid' },
          {},
          { ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE }
        );

        const session = await persistence.getSession(result.sessionId);
        expect(session.context.ownershipScope).toBe(
          EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id
        );
        expect(mockCtx.logger.info).toHaveBeenCalledWith(
          expect.stringContaining(
            EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.label
          ),
          expect.objectContaining({
            ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id,
          })
        );
      });

      it('names the scope when a selected run starts', async () => {
        await coordinator.runDeleteSelectedAndMonitor(
          { correlationId: 'test-cid' },
          {},
          {
            deleteScope: [{ name: 'deleteOrders' }],
            ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
          }
        );

        expect(mockCtx.logger.info).toHaveBeenCalledWith(
          expect.stringContaining(
            EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.label
          ),
          expect.objectContaining({
            ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id,
          })
        );
      });

      it('refuses a scope that arrived as a string rather than starting a run', async () => {
        expect(() =>
          coordinator.runDeleteAndMonitor(
            { correlationId: 'x' },
            {},
            {
              ownershipScope: 'everything',
            }
          )
        ).toThrow(TypeError);

        await expect(
          coordinator.runDeleteSelectedAndMonitor(
            { correlationId: 'x' },
            {},
            {
              deleteScope: [{ name: 'deleteOrders' }],
              ownershipScope: true,
            }
          )
        ).rejects.toThrow(TypeError);
      });
    });
  });

  describe('a total run no longer widens on an empty manifest (#858)', () => {
    // One AICA option and one somebody made by hand. Before #858 a total run
    // took both, on any step whose manifest entry came back empty, with no
    // confirmation anywhere - while the deliberate route to the same outcome
    // needed an exact phrase typed out.
    const mixedOptions = {
      items: [
        { id: 1, externalReferenceCode: 'AICA-OPT-COLOUR' },
        { id: 2, externalReferenceCode: 'COLOUR-BY-HAND' },
      ],
      totalCount: 2,
    };

    const seedTotalRun = async (sessionId, step, manifest, ownershipScope) => {
      await persistence.createSession({
        sessionId,
        flowType: 'delete',
        status: 'STARTED',
        currentSteps: [step],
        context: {
          config: {},
          options: {},
          catalogId: 77,
          steps: [{ name: step }],
          // Exactly what runDeleteAndMonitor records: a full 'delete all
          // commerce data' run.
          isTotal: true,
          manifest,
          ownershipScope,
        },
      });
    };

    const statusFor = async (sessionId, step) => {
      const batches = await persistence.getBatchesForSession(sessionId);
      return batches.filter((b) => b.step_key === step).map((b) => b.status);
    };

    const warnMatching = (pattern) =>
      mockCtx.logger.warn.mock.calls.filter(([message]) =>
        pattern.test(message)
      );

    it('leaves data AICA did not create alone under the default scope', async () => {
      mockCtx.liferay.getOptions.mockResolvedValue(mixedOptions);

      await seedTotalRun('sess-858-default', 'delete-options', {
        options: [],
      });
      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-858-default'
      );

      const [, args] = mockCtx.liferay.deleteOptionsBatch.mock.calls[0];
      expect(args.items.map((i) => i.id)).toEqual([1]);
    });

    it('removes it once the everything scope is selected', async () => {
      mockCtx.liferay.getOptions.mockResolvedValue(mixedOptions);

      await seedTotalRun(
        'sess-858-everything',
        'delete-options',
        { options: [] },
        EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id
      );
      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-858-everything'
      );

      const [, args] = mockCtx.liferay.deleteOptionsBatch.mock.calls[0];
      expect(args.items.map((i) => i.id)).toEqual([1, 2]);
    });

    it('bypasses rather than widening when nothing found is AICA-owned', async () => {
      mockCtx.liferay.getOptions.mockResolvedValue({
        items: [
          { id: 2, externalReferenceCode: 'COLOUR-BY-HAND' },
          { id: 3, externalReferenceCode: 'SIZE-BY-HAND' },
        ],
        totalCount: 2,
      });

      await seedTotalRun('sess-858-bypass', 'delete-options', { options: [] });
      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-858-bypass'
      );

      expect(mockCtx.liferay.deleteOptionsBatch).not.toHaveBeenCalled();
      expect(await statusFor('sess-858-bypass', 'delete-options')).toContain(
        'BYPASSED'
      );
    });

    it('says in the log what it left behind and why', async () => {
      mockCtx.liferay.getOptions.mockResolvedValue(mixedOptions);

      await seedTotalRun('sess-858-log-withheld', 'delete-options', {
        options: [],
      });
      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-858-log-withheld'
      );

      const [message, fields] = warnMatching(/left 1 item\(s\) in place/)[0];
      expect(message).toContain(AICA_OWNED.label);
      expect(fields).toMatchObject({
        ownershipScope: AICA_OWNED.id,
        withheldCount: 1,
      });

      // Nothing was widened, so nothing claims it was.
      expect(warnMatching(/widened past AICA's own data/)).toHaveLength(0);
    });

    it('says in the log when a step widened, and by how much', async () => {
      mockCtx.liferay.getOptions.mockResolvedValue(mixedOptions);

      await seedTotalRun(
        'sess-858-log-widened',
        'delete-options',
        { options: [] },
        EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id
      );
      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-858-log-widened'
      );

      // 'deleted 2' and 'deleted 2, one of which was not ours' are the same
      // row count. Only the log tells them apart afterwards.
      const [message, fields] = warnMatching(/widened past AICA's own data/)[0];
      expect(message).toContain('1 of 2 discovered item(s)');
      expect(message).toContain(
        EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.label
      );
      expect(fields).toMatchObject({
        ownershipScope: EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id,
        widenedCount: 1,
      });
    });

    describe('warehouse items, which the crawl never collects', () => {
      // AICA creates warehouse items with no external reference code, so the
      // AICA-owned scope can attribute none of them. This step therefore
      // always arrives at live discovery and always used to sweep every
      // warehouse in the instance - the sharpest form of the #858 hole.
      const unattributableItems = {
        items: [
          { id: 501, sku: 'SKU-1' },
          { id: 502, sku: 'SKU-2' },
        ],
        totalCount: 2,
      };

      beforeEach(() => {
        mockCtx.liferay.deleteWarehouseItemsBatch = vi
          .fn()
          .mockResolvedValue({ success: true, count: 2 });
        mockCtx.liferay.getAllWarehouseItems.mockResolvedValue(
          unattributableItems
        );
      });

      it('bypasses under the default scope, leaving them to their warehouse', async () => {
        await seedTotalRun('sess-858-wh-default', 'delete-warehouse-items', {
          warehouseItems: [],
        });
        await coordinator._runGenericDeletionStep(
          'deleteWarehouseItems',
          'sess-858-wh-default'
        );

        expect(
          mockCtx.liferay.deleteWarehouseItemsBatch
        ).not.toHaveBeenCalled();
        expect(
          await statusFor('sess-858-wh-default', 'delete-warehouse-items')
        ).toContain('BYPASSED');
      });

      it('sweeps them when the run asked for everything', async () => {
        await seedTotalRun(
          'sess-858-wh-everything',
          'delete-warehouse-items',
          { warehouseItems: [] },
          EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id
        );
        await coordinator._runGenericDeletionStep(
          'deleteWarehouseItems',
          'sess-858-wh-everything'
        );

        const [, args] =
          mockCtx.liferay.deleteWarehouseItemsBatch.mock.calls[0];
        expect(args.items.map((i) => i.id)).toEqual([501, 502]);
      });
    });
  });

  describe('a step that deletes nothing does not report success (#657)', () => {
    const seedSession = async (sessionId, step, manifest) => {
      await persistence.createSession({
        sessionId,
        flowType: 'delete',
        status: 'STARTED',
        currentSteps: [step],
        context: {
          config: {},
          options: {},
          steps: [{ name: step }],
          isTotal: true,
          manifest,
        },
      });
    };

    it('marks the step FAILED when the handler removed none of its targets', async () => {
      mockCtx.liferay.deletePromotionsBatch.mockResolvedValue({
        success: true,
        count: 0,
      });

      await seedSession('sess-promo-zero', 'delete-promotions', {
        promotions: [{ id: 10, externalReferenceCode: 'AICA-PROMO-1' }],
      });

      await coordinator._runGenericDeletionStep(
        'deletePromotions',
        'sess-promo-zero'
      );

      const batches = await persistence.getBatchesForSession('sess-promo-zero');
      const statuses = batches
        .filter((b) => b.step_key === 'delete-promotions')
        .map((b) => b.status);

      expect(statuses).toContain('FAILED');
      expect(statuses).not.toContain('COMPLETED');
      expect(mockCtx.logger.error).toHaveBeenCalled();
    });

    it('records what the handler actually removed, not what was targeted', async () => {
      mockCtx.liferay.deleteOptionsBatch.mockResolvedValue({
        success: true,
        count: 1,
      });

      await seedSession('sess-opt-partial', 'delete-options', {
        options: [
          { id: 1, externalReferenceCode: 'AICA-OPT-A' },
          { id: 2, externalReferenceCode: 'AICA-OPT-B' },
        ],
      });

      await coordinator._runGenericDeletionStep(
        'deleteOptions',
        'sess-opt-partial'
      );

      const batches =
        await persistence.getBatchesForSession('sess-opt-partial');
      const workBatch = batches.find(
        (b) => b.step_key === 'delete-options' && b.status === 'COMPLETED'
      );

      expect(workBatch).toBeDefined();
      expect(workBatch.processed_count).toBe(1);
      expect(workBatch.total_count).toBe(2);
    });
  });
});
