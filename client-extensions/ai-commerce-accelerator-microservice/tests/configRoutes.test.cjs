const configRoute = require('../routes/config.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');

describe('Config Routes', () => {
  let appMock;
  let mockLogger;
  let mockConfigService;
  let mockPersistenceService;
  const registeredRoutes = {};

  beforeEach(() => {
    registeredRoutes.get = {};
    registeredRoutes.post = {};

    appMock = {
      get: vi.fn((path, handler) => {
        registeredRoutes.get[path] = handler;
      }),
      post: vi.fn((path, handler) => {
        registeredRoutes.post[path] = handler;
      }),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      errorWithStack: vi.fn(),
      trace: vi.fn(),
    };

    mockConfigService = {
      getAIConfig: vi.fn().mockResolvedValue({ provider: 'gemini' }),
      getAIPromptsConfig: vi.fn().mockResolvedValue({}),
      getAIKey: vi.fn().mockResolvedValue('mock-ai-text-key-for-testing'),
      getAIMediaKey: vi.fn().mockResolvedValue('mock-ai-media-key-for-testing'),
      getBatchSizes: vi.fn().mockResolvedValue([1, 5, 10]),
      clearCache: vi.fn(),
    };

    mockPersistenceService = {
      getSystemSetting: vi.fn(),
      saveSystemSetting: vi.fn(),
    };

    // Initialize routes
    configRoute(appMock, {
      logger: mockLogger,
      configService: mockConfigService,
      persistenceService: mockPersistenceService,
    });
  });

  it('should register both GET and POST routes for AI config and batch sizes', () => {
    expect(appMock.get).toHaveBeenCalledWith(
      INTERNAL_API_PATHS.CONFIG_AI,
      expect.any(Function)
    );
    expect(appMock.post).toHaveBeenCalledWith(
      INTERNAL_API_PATHS.CONFIG_AI,
      expect.any(Function)
    );

    expect(appMock.get).toHaveBeenCalledWith(
      INTERNAL_API_PATHS.CONFIG_BATCH_SIZES,
      expect.any(Function)
    );
    expect(appMock.post).toHaveBeenCalledWith(
      INTERNAL_API_PATHS.CONFIG_BATCH_SIZES,
      expect.any(Function)
    );

    expect(appMock.post).toHaveBeenCalledWith(
      '/config/save',
      expect.any(Function)
    );
  });

  it('should handle POST /config/ai and return correct payloads including generationConfig', async () => {
    const handler = registeredRoutes.post[INTERNAL_API_PATHS.CONFIG_AI];
    expect(handler).toBeDefined();

    mockPersistenceService.getSystemSetting.mockImplementation((key) => {
      if (key === 'generation_config') {
        return JSON.stringify({ productCount: 10 });
      }
      if (key === 'cli_config') {
        return JSON.stringify({ demoMode: true });
      }
      return null;
    });

    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'mock-id',
        clientSecret: 'mock-secret',
      },
      headers: {},
      app: {},
    };

    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        config: expect.objectContaining({
          demoMode: true,
          ai: { provider: 'gemini' },
          maskedApiKey: expect.stringContaining('********'),
        }),
        generationConfig: { productCount: 10 },
      })
    );
  });

  it('should handle POST /config/save and persist settings', async () => {
    const handler = registeredRoutes.post['/config/save'];
    expect(handler).toBeDefined();

    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        config: {
          liferayUrl: 'http://localhost:8080',
          clientId: 'test-client',
          clientSecret: 'test-secret',
        },
        generationConfig: {
          productCount: 15,
        },
      },
      headers: {},
    };

    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    await handler(req, res);

    expect(mockPersistenceService.saveSystemSetting).toHaveBeenCalledWith(
      'generation_config',
      JSON.stringify({ productCount: 15 })
    );
    expect(mockPersistenceService.saveSystemSetting).toHaveBeenCalledWith(
      'cli_config',
      JSON.stringify(req.body.config)
    );
    expect(mockPersistenceService.saveSystemSetting).toHaveBeenCalledWith(
      'active_liferay_url',
      'http://localhost:8080'
    );
    expect(mockPersistenceService.saveSystemSetting).toHaveBeenCalledWith(
      'active_client_id',
      'test-client'
    );
    expect(mockPersistenceService.saveSystemSetting).toHaveBeenCalledWith(
      'active_client_secret',
      'test-secret'
    );

    expect(mockConfigService.clearCache).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
      })
    );
  });
});
