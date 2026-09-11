const importRoute = require('../routes/import.cjs');

describe('Import Workflow Logic', () => {
  let mockApp;
  let mockLogger;
  let mockPersistence;
  let mockProgress;
  let mockCoordinator;
  let mockBatchCallback;
  let mockLiferay;
  let routeHandler;

  beforeEach(() => {
    mockApp = {
      // Positional capture would take a middleware now that the write
      // routes guard their target; the terminal handler is always last.
      // See #815.
      post: vi.fn().mockImplementation((_path, ...handlers) => {
        routeHandler = handlers[handlers.length - 1];
      }),
    };

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    };

    mockPersistence = {
      createSession: vi.fn().mockResolvedValue({}),
    };

    mockProgress = {
      sessionStarted: vi.fn(),
    };

    mockCoordinator = {
      runWorkflow: vi.fn(),
    };

    mockBatchCallback = {
      _checkSessionCompletion: vi.fn(),
    };

    // An import resolves its catalog and channel before it writes anything,
    // and refuses the run when it cannot read them (#889), so the service has
    // to answer.
    mockLiferay = {
      getCatalogs: vi.fn().mockResolvedValue([{ id: 102, name: 'Catalog' }]),
      getChannels: vi
        .fn()
        .mockResolvedValue([{ id: 301, name: 'Channel', siteGroupId: 900 }]),
    };

    // Initialize route
    importRoute(mockApp, {
      logger: mockLogger,
      persistenceService: mockPersistence,
      progressService: mockProgress,
      workflowCoordinator: mockCoordinator,
      batchCallbackService: mockBatchCallback,
      liferayService: mockLiferay,
    });
  });

  it('should initialize a workflow session when a valid JSON is uploaded', async () => {
    const sampleData = {
      products: [{ name: 'Test Product', externalReferenceCode: 'TP-001' }],
      accounts: [{ name: 'Test Account', externalReferenceCode: 'TA-001' }],
    };

    const req = {
      file: {
        buffer: Buffer.from(JSON.stringify(sampleData)),
      },
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
      headers: {
        'x-correlation-id': 'test-correlation-id',
      },
      correlationId: 'test-correlation-id',
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await routeHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        sessionId: expect.any(String),
      })
    );

    expect(mockPersistence.createSession).toHaveBeenCalled();
    const sessionArgs = mockPersistence.createSession.mock.calls[0][0];
    expect(sessionArgs.flowType).toBe('import');
    expect(sessionArgs.context.productDataList).toHaveLength(1);
    expect(sessionArgs.context.accountDataList).toHaveLength(1);
    expect(sessionArgs.context.steps).toHaveLength(1); // Parallel block for products & accounts
  });

  it('should return 400 if no file is uploaded', async () => {
    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
      headers: { 'x-liferay-url': 'http://localhost:8080' },
      correlationId: 'test-correlation-id',
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await routeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'No file uploaded',
      })
    );
  });
});
