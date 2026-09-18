const ConfigService = require('../services/configService.cjs');
const { ENV } = require('../utils/constants.cjs');
const { DEFAULT_CHUNK_SIZES } = require('../utils/aiRequestOptions.cjs');

/**
 * That configuration is read from the configuration source, and that a source
 * which cannot be read refuses rather than substituting.
 *
 * The easy mistake this file is written against: a test that passes whether or
 * not configuration actually came from the configuration source. Every
 * assertion here therefore inspects the connection `liferay.getConfig` was
 * handed, not merely the value that came back - a service that ignored
 * `configSource` entirely would return exactly the same value and satisfy a
 * weaker test. See #824.
 */
describe('ConfigService reads over the configuration source (#824)', () => {
  const TARGET = {
    liferayUrl: 'https://lctsolara-uat.lfr.cloud',
    clientId: 'target-id',
    clientSecret: 'target-secret',
  };

  const CONFIG_SOURCE = {
    liferayUrl: 'http://localhost:8080',
    clientId: 'local-id',
    clientSecret: 'local-secret',
  };

  let configService;
  let mockCtx;
  let savedEnv;

  beforeEach(() => {
    const store = new Map();
    mockCtx = {
      cache: {
        get: vi.fn((key) => store.get(key)),
        set: vi.fn((key, value) => store.set(key, value)),
        delete: vi.fn((key) => store.delete(key)),
        clear: vi.fn(() => store.clear()),
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
    configService.setLiferayService({
      getConfig: vi.fn().mockResolvedValue({ items: [] }),
      updateConfig: vi.fn(),
    });

    savedEnv = {
      url: ENV.AICA_CONFIG_SOURCE_URL,
      key: ENV.AI_API_KEY,
    };
    ENV.AICA_CONFIG_SOURCE_URL = '';
    ENV.AI_API_KEY = '';
  });

  afterEach(() => {
    ENV.AICA_CONFIG_SOURCE_URL = savedEnv.url;
    ENV.AI_API_KEY = savedEnv.key;
  });

  const connectionsUsed = () =>
    configService.liferay.getConfig.mock.calls.map(
      ([connection]) => connection
    );

  it('sends the configuration source connection, not the target', async () => {
    configService.liferay.getConfig.mockResolvedValue({
      items: [{ configValue: JSON.stringify({ ttl: 600 }) }],
    });

    await configService.getCacheConfig({
      ...TARGET,
      configSource: CONFIG_SOURCE,
    });

    expect(connectionsUsed()).toHaveLength(1);
    expect(connectionsUsed()[0].liferayUrl).toBe('http://localhost:8080');
    expect(connectionsUsed()[0].clientId).toBe('local-id');
    expect(connectionsUsed()[0].clientSecret).toBe('local-secret');
  });

  it('sends the target connection when no configuration source is stated', async () => {
    configService.liferay.getConfig.mockResolvedValue({
      items: [{ configValue: JSON.stringify({ ttl: 600 }) }],
    });

    await configService.getCacheConfig({ ...TARGET });

    expect(connectionsUsed()[0].liferayUrl).toBe(
      'https://lctsolara-uat.lfr.cloud'
    );
    expect(connectionsUsed()[0].clientId).toBe('target-id');
  });

  it('reads ai-config over the configuration source too', async () => {
    configService.liferay.getConfig.mockResolvedValue({
      items: [{ configValue: JSON.stringify({ defaultModel: 'gpt-4o' }) }],
    });

    await configService.getAIConfig({ ...TARGET, configSource: CONFIG_SOURCE });

    expect(connectionsUsed().length).toBeGreaterThan(0);
    for (const connection of connectionsUsed()) {
      expect(connection.liferayUrl).toBe('http://localhost:8080');
    }
  });

  it('does not serve a value cached against a different configuration source', async () => {
    configService.liferay.getConfig.mockResolvedValue({
      items: [{ configValue: JSON.stringify({ ttl: 600 }) }],
    });

    await configService.getCacheConfig({
      ...TARGET,
      configSource: CONFIG_SOURCE,
    });

    configService.liferay.getConfig.mockResolvedValue({
      items: [{ configValue: JSON.stringify({ ttl: 999 }) }],
    });

    const second = await configService.getCacheConfig({ ...TARGET });

    // A cache keyed by config key alone would have answered 600 here, from the
    // other instance. Stale is as silent as invented.
    expect(second).toEqual({ ttl: 999 });
    expect(configService.liferay.getConfig).toHaveBeenCalledTimes(2);
  });

  describe('a configuration source that cannot be read', () => {
    beforeEach(() => {
      configService.liferay.getConfig.mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:8080')
      );
    });

    it('refuses rather than returning a chunk-size literal', async () => {
      await expect(
        configService.getAIChunkSizes({
          ...TARGET,
          configSource: CONFIG_SOURCE,
        })
      ).rejects.toThrow(/could not be read from the configuration source/i);
    });

    it('names the instance it could not read', async () => {
      await expect(
        configService.getAIChunkSizes({
          ...TARGET,
          configSource: CONFIG_SOURCE,
        })
      ).rejects.toThrow(/http:\/\/localhost:8080/);
    });

    it('does not report an unreachable instance as a missing AI key', async () => {
      // "Not configured" is a claim about the configuration, and the read never
      // got far enough to make it. The error that names the instance travels
      // rather than being replaced by a diagnosis nothing established.
      await expect(
        configService.getAIKey({ ...TARGET, configSource: CONFIG_SOURCE })
      ).rejects.toThrow(/could not be read from the configuration source/i);
    });

    it('refuses rather than returning a null AI config', async () => {
      await expect(
        configService.getAIConfig({ ...TARGET, configSource: CONFIG_SOURCE })
      ).rejects.toThrow(/ConfigurationSourceUnavailable|could not be read/i);
    });
  });

  describe('a configuration source that answers but holds nothing', () => {
    it('does not invent a model, and says the default was applied', async () => {
      ENV.AI_API_KEY = 'sk-from-env';

      const aiConfig = await configService.getAIConfig({
        ...TARGET,
        configSource: CONFIG_SOURCE,
      });

      expect(aiConfig.apiKey).toBe('sk-from-env');
      expect(aiConfig.defaultModel).toBeUndefined();
      expect(aiConfig.provider).toBeUndefined();
      expect(aiConfig.aicaFallback.configurationSource.liferayUrl).toBe(
        'http://localhost:8080'
      );
      expect(mockCtx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('ai-config'),
        expect.objectContaining({
          operation: 'configuration-default-applied',
        })
      );
    });

    it('applies AICA chunk-size defaults out loud, pricing included', async () => {
      ENV.AI_API_KEY = 'sk-from-env';

      const sizes = await configService.getAIChunkSizes({
        ...TARGET,
        configSource: CONFIG_SOURCE,
      });

      expect(sizes).toEqual(DEFAULT_CHUNK_SIZES);
      expect(sizes.pricing).toBe(10);
      expect(mockCtx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('ai-chunk-sizes'),
        expect.objectContaining({
          operation: 'configuration-default-applied',
        })
      );
    });

    it('treats a record that is not a JSON object as holding nothing', async () => {
      ENV.AI_API_KEY = 'sk-from-env';
      configService.liferay.getConfig.mockImplementation(async (_c, key) =>
        key === 'ai-config'
          ? { items: [{ configValue: 'not-json' }] }
          : { items: [] }
      );

      // It used to throw here - assigning apiKey onto a string - and the throw
      // was swallowed by a catch that returned null, so a malformed record was
      // indistinguishable from a healthy one that had never been read.
      const aiConfig = await configService.getAIConfig({ ...TARGET });

      expect(aiConfig.apiKey).toBe('sk-from-env');
      expect(aiConfig.aicaFallback.reason).toMatch(
        /does not hold a JSON object/
      );
    });
  });
});
