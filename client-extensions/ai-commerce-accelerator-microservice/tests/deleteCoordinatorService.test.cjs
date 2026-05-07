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

  afterEach(() => {
    persistence.close();
  });

  it('should start full deletion workflow with correct name', async () => {
    const config = { correlationId: 'test-cid' };
    const options = {};

    const result = coordinator.runDeleteAndMonitor(config, options);

    expect(result.sessionId).toBeDefined();
    const session = persistence.getSession(result.sessionId);
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
    const session = persistence.getSession(result.sessionId);
    expect(session.flow_type).toBe('delete');
    expect(session.session_name).toBe('Delete Selected Commerce Data');
  });

  it('should run discovery step', async () => {
    const sessionId = 'delete-test-session';
    persistence.createSession({
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

    const session = persistence.getSession(sessionId);
    expect(session.context.manifest).toBeDefined();
    expect(mockCtx.progress.stepProgress).toHaveBeenCalled();

    // Verify implicit milestones were marked as completed
    expect(mockCtx.progress.stepCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'addresses' })
    );
    expect(mockCtx.progress.stepCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'images' })
    );
    expect(mockCtx.progress.stepCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'pdfs' })
    );
  });

  it('should handle order deletion step', async () => {
    const sessionId = 'test-session';
    persistence.createSession({
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
