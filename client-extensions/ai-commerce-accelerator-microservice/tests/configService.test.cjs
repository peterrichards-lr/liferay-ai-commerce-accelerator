const ConfigService = require('../services/configService.cjs');

describe('ConfigService', () => {
  let configService;
  let mockCtx;
  const requestConfig = {
    liferayUrl: 'http://localhost:8080',
    clientId: 'test-id',
    clientSecret: 'test-secret',
  };

  beforeEach(() => {
    const mockCache = new Map();
    mockCtx = {
      cache: {
        get: vi.fn((key) => mockCache.get(key)),
        set: vi.fn((key, value) => mockCache.set(key, value)),
        delete: vi.fn((key) => mockCache.delete(key)),
        clear: vi.fn(() => mockCache.clear()),
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        errorWithStack: vi.fn(),
      },
    };
    configService = new ConfigService(mockCtx);
    const mockLiferay = {
      getConfig: vi.fn(),
      updateConfig: vi.fn(),
    };
    configService.setLiferayService(mockLiferay);
  });

  it('should fetch workflow resilience config and cache it', async () => {
    const mockResilience = {
      initialDelayMs: 1000,
      maxRetries: 3,
      multiplier: 1.5,
    };
    configService.liferay.getConfig.mockResolvedValue({
      items: [{ configValue: JSON.stringify(mockResilience) }],
    });

    const result =
      await configService.getWorkflowResilienceConfig(requestConfig);

    expect(result).toEqual(mockResilience);
    expect(mockCtx.cache.set).toHaveBeenCalledWith(
      'WORKFLOW_RESILIENCE_CONFIG_KEY',
      mockResilience,
      undefined
    );
  });

  it('should return default resilience config if fetching fails', async () => {
    configService.liferay.getConfig.mockRejectedValue(
      new Error('Liferay error')
    );

    const result =
      await configService.getWorkflowResilienceConfig(requestConfig);

    expect(result).toEqual({}); // Returns empty object on failure because of _getConfigWithFallback

    // Check cached version returns hardcoded defaults if nothing in cache
    const cached = configService.getWorkflowResilienceConfigCached();
    expect(cached).toEqual({
      initialDelayMs: 5000,
      maxRetries: 5,
      multiplier: 2,
      deletionConcurrency: 5,
    });
  });

  it('should return cached value if available', async () => {
    const mockResilience = {
      initialDelayMs: 2000,
      maxRetries: 10,
      multiplier: 3,
    };
    mockCtx.cache.get.mockReturnValue(mockResilience);

    const result =
      await configService.getWorkflowResilienceConfig(requestConfig);

    expect(result).toEqual(mockResilience);
    expect(configService.liferay.getConfig).not.toHaveBeenCalled();
  });
});
