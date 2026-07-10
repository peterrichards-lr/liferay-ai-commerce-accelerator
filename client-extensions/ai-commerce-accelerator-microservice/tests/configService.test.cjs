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

  describe('Configuration profiles & caching', () => {
    const testConfigs = [
      {
        name: 'AIConfig',
        method: 'getAIConfig',
        key: 'ai-config',
        value: { model: 'gpt-4' },
      },
      {
        name: 'OAuthConfig',
        method: 'getOAuthConfig',
        key: 'oauth-config',
        value: { clientSecret: 'abc' },
      },
      {
        name: 'DefaultImage',
        method: 'getDefaultImage',
        key: 'default-image',
        value: { url: 'img.jpg' },
      },
      {
        name: 'DefaultPdf',
        method: 'getDefaultPdf',
        key: 'default-pdf',
        value: { template: 't1' },
      },
      {
        name: 'CacheConfig',
        method: 'getCacheConfig',
        key: 'cache-config',
        value: { ttl: 600 },
      },
      {
        name: 'BatchPollingConfig',
        method: 'getBatchPollingConfig',
        key: 'batch-polling-config',
        value: { interval: 5000 },
      },
      {
        name: 'QueueConfig',
        method: 'getQueueConfig',
        key: 'queue-config',
        value: { concurrency: 5 },
      },
      {
        name: 'LogManagementConfig',
        method: 'getLogManagementConfig',
        key: 'LOG_MANAGEMENT_KEY',
        value: { retentionCount: 15, autoCycleTime: '01:00', enabled: false },
        skipCached: true,
      },
      {
        name: 'BatchSizes',
        method: 'getBatchSizes',
        key: 'batch-sizes',
        value: [5, 10, 20],
      },
      {
        name: 'AIModelOptions',
        method: 'getAIModelOptions',
        key: 'ai-model-options',
        value: [{ label: 'GPT-4', value: 'gpt-4' }],
        expected: {
          aiModelOptions: [{ label: 'GPT-4', value: 'gpt-4' }],
          defaultModel: 'gpt-4',
        },
        customCacheValue: [{ label: 'GPT-4', value: 'gpt-4' }],
      },
      {
        name: 'ExcludeLists',
        method: 'getExcludeLists',
        key: 'ai-exclude-lists',
        value: { categories: [] },
      },
      {
        name: 'GenerationLimits',
        method: 'getGenerationLimits',
        key: 'generation-limits',
        value: { maxProducts: 100 },
      },
    ];

    testConfigs.forEach(
      ({
        name,
        method,
        key,
        value,
        expected,
        skipCached,
        customCacheValue,
      }) => {
        it(`should fetch, parse, cache, and resolve ${name}`, async () => {
          configService.liferay.getConfig.mockResolvedValue({
            items: [
              {
                configValue:
                  typeof value === 'string' ? value : JSON.stringify(value),
              },
            ],
          });

          // First call fetches from Liferay
          const result1 = await configService[method](requestConfig);
          expect(result1).toEqual(expected || value);
          expect(configService.liferay.getConfig).toHaveBeenCalledWith(
            requestConfig,
            key
          );

          // Next cached helpers
          if (!skipCached) {
            const cachedMethod = `${method}Cached`;
            if (typeof configService[cachedMethod] === 'function') {
              const cachedVal = configService[cachedMethod]();
              expect(cachedVal).toEqual(expected || value);
            }
          }

          // Subsequent call uses cache
          configService.liferay.getConfig.mockClear();
          mockCtx.cache.get.mockReturnValue(
            customCacheValue !== undefined
              ? customCacheValue
              : expected || value
          );
          const result2 = await configService[method](requestConfig);
          expect(result2).toEqual(expected || value);
          expect(configService.liferay.getConfig).not.toHaveBeenCalled();
        });
      }
    );

    it('should fetch, parse, cache, and resolve AISchema', async () => {
      const mockSchema = { type: 'object' };
      configService.liferay.getConfig.mockResolvedValue({
        items: [{ configValue: JSON.stringify(mockSchema) }],
      });

      const result1 = await configService.getAISchema(requestConfig, 'product');
      expect(result1).toEqual(mockSchema);
      expect(configService.liferay.getConfig).toHaveBeenCalledWith(
        requestConfig,
        'ai-schema-product'
      );

      mockCtx.cache.get.mockReturnValue(mockSchema);
      const result2 = await configService.getAISchema(requestConfig, 'product');
      expect(result2).toEqual(mockSchema);
    });

    it('should fetch, parse, cache, and resolve AIPrompt', async () => {
      const mockPrompt = 'prompt content';
      configService.liferay.getConfig.mockResolvedValue({
        items: [{ configValue: mockPrompt }],
      });

      const result1 = await configService.getAIPrompt(requestConfig, 'product');
      expect(result1).toBe(mockPrompt);
      expect(configService.liferay.getConfig).toHaveBeenCalledWith(
        requestConfig,
        'ai-prompt-product'
      );

      mockCtx.cache.get.mockReturnValue(mockPrompt);
      const result2 = await configService.getAIPrompt(requestConfig, 'product');
      expect(result2).toBe(mockPrompt);
    });

    it('should fetch, parse, cache, and resolve getCategories', async () => {
      const mockCategories = { categories: [] };
      configService.liferay.getConfig.mockResolvedValue({
        items: [{ configValue: JSON.stringify(mockCategories) }],
      });

      const result1 = await configService.getCategories(requestConfig);
      expect(result1).toEqual(mockCategories);
      expect(configService.liferay.getConfig).toHaveBeenCalledWith(
        requestConfig,
        'ai-categories'
      );

      mockCtx.cache.get.mockReturnValue(mockCategories);
      const result2 = await configService.getCategories(requestConfig);
      expect(result2).toEqual(mockCategories);
    });
  });

  describe('Fallback resolving to environment variables', () => {
    const { ENV } = require('../utils/constants.cjs');
    let originalApiKey;
    let originalMediaKey;

    beforeEach(() => {
      originalApiKey = ENV.AI_API_KEY;
      originalMediaKey = ENV.AI_MEDIA_API_KEY;
    });

    afterEach(() => {
      ENV.AI_API_KEY = originalApiKey;
      ENV.AI_MEDIA_API_KEY = originalMediaKey;
    });

    it('should resolve AI API Key from config first', async () => {
      const mockCredentials = 'liferay-key';
      configService.liferay.getConfig.mockResolvedValue({
        items: [{ configValue: mockCredentials }],
      });
      ENV.AI_API_KEY = 'env-key';

      const key = await configService.getAIKey(requestConfig);
      expect(key).toBe('liferay-key');
    });

    it('should fallback to ENV.AI_API_KEY if Liferay config fails/is missing', async () => {
      configService.liferay.getConfig.mockRejectedValue(
        new Error('Liferay down')
      );
      ENV.AI_API_KEY = 'env-key';

      const key = await configService.getAIKey(requestConfig);
      expect(key).toBe('env-key');
    });

    it('should return null if AI API Key is nowhere to be found', async () => {
      configService.liferay.getConfig.mockResolvedValue({ items: [] });
      ENV.AI_API_KEY = '';

      const key = await configService.getAIKey(requestConfig);
      expect(key).toBeNull();
    });

    it('should resolve AI Media API Key from config first', async () => {
      const mockCredentials = 'liferay-media-key';
      configService.liferay.getConfig.mockResolvedValue({
        items: [{ configValue: mockCredentials }],
      });
      ENV.AI_MEDIA_API_KEY = 'env-media-key';

      const key = await configService.getAIMediaKey(requestConfig);
      expect(key).toBe('liferay-media-key');
    });

    it('should fallback to ENV.AI_MEDIA_API_KEY if Liferay config fails/is missing', async () => {
      configService.liferay.getConfig.mockRejectedValue(
        new Error('Liferay down')
      );
      ENV.AI_MEDIA_API_KEY = 'env-media-key';

      const key = await configService.getAIMediaKey(requestConfig);
      expect(key).toBe('env-media-key');
    });
  });

  describe('Validation & error boundaries', () => {
    it('should throw Error when requestConfig is missing', async () => {
      await expect(
        configService.getConfig(null, 'cacheKey', 'configKey')
      ).rejects.toThrow('OAuth configuration required');
      expect(mockCtx.logger.errorWithStack).toHaveBeenCalled();
    });
  });
});
