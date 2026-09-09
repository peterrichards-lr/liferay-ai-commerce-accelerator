const DeleteCoordinatorService = require('../services/deleteCoordinatorService.cjs');
const PersistenceService = require('../services/persistenceService.cjs');

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
    const seedSession = async (sessionId, step, { manifest, isTotal }) => {
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
      expect(args.items.map((i) => i.id)).toEqual([1, 2]);
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

      await seedSession('sess-promo-discovery', 'delete-promotions', {
        manifest: { promotions: [] },
        isTotal: true,
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
