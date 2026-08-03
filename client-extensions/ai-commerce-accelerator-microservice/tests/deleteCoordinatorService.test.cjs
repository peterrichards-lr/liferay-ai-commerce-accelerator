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
        getChannels: vi.fn().mockResolvedValue([]),
        _collectAllItems: vi.fn().mockResolvedValue({ items: [] }),
        deleteOrdersBatch: vi.fn().mockResolvedValue({ success: true }),
        deleteAccountsBatch: vi.fn().mockResolvedValue({ success: true }),
        deleteAccountGroupsBatch: vi.fn().mockResolvedValue({ success: true }),
        deleteProductsBatch: vi.fn().mockResolvedValue({ success: true }),
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
});
