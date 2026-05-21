const importRoute = require('../routes/import.cjs');

describe('Import Workflow Logic', () => {
  let mockApp;
  let mockLogger;
  let mockPersistence;
  let mockProgress;
  let mockCoordinator;
  let mockBatchCallback;
  let routeHandler;

  beforeEach(() => {
    mockApp = {
      post: vi.fn().mockImplementation((path, multer, handler) => {
        routeHandler = handler;
      }),
    };

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
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

    // Initialize route
    importRoute(mockApp, {
      logger: mockLogger,
      persistenceService: mockPersistence,
      progressService: mockProgress,
      workflowCoordinator: mockCoordinator,
      batchCallbackService: mockBatchCallback,
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
