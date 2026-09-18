const { AIService } = require('../services/aiService.cjs');
const { ENV } = require('../utils/constants.cjs');
const {
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
  DEFAULT_CHUNK_SIZES,
} = require('../utils/aiRequestOptions.cjs');

/**
 * The literals #824 names, and what now happens instead.
 *
 * `aiService.cjs` fell through to `60000` and the run died three times at 60s
 * against a panel set to 300000; `getAIChunkSizes` substituted its own
 * `{ product: 10, ... }`. Neither number was wrong on its own - what was wrong
 * was arriving at it in silence, with the configuration having been read from
 * the instance being written to rather than the one holding it.
 */
describe('AI runtime defaults are named rather than silent (#824)', () => {
  const baseConfig = (overrides = {}) => ({
    getAIConfig: vi.fn().mockResolvedValue({
      defaultModel: 'gpt-4o',
      provider: 'openai',
    }),
    getAIKey: vi.fn().mockResolvedValue('sk-test'),
    getAIMediaKey: vi.fn().mockResolvedValue('sk-test'),
    getAIChunkSizes: vi.fn().mockResolvedValue({ ...DEFAULT_CHUNK_SIZES }),
    reportDefaultApplied: vi.fn(),
    ...overrides,
  });

  const serviceWith = (config) =>
    new AIService({
      config,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        errorWithStack: vi.fn(),
      },
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    });

  let savedTimeout;

  beforeEach(() => {
    savedTimeout = ENV.AI_REQUEST_TIMEOUT_MS;
    ENV.AI_REQUEST_TIMEOUT_MS = null;
  });

  afterEach(() => {
    ENV.AI_REQUEST_TIMEOUT_MS = savedTimeout;
  });

  it('reports that the request timeout fell to AICA’s own default', async () => {
    const config = baseConfig();
    const runtime = await serviceWith(config).getRuntimeAIConfig({});

    expect(runtime.requestTimeoutMs).toBe(DEFAULT_AI_REQUEST_TIMEOUT_MS);
    expect(config.reportDefaultApplied).toHaveBeenCalledWith(
      {},
      'requestTimeoutMs',
      expect.objectContaining({
        appliedDefault: DEFAULT_AI_REQUEST_TIMEOUT_MS,
      })
    );
  });

  it('says nothing when the timeout was actually configured', async () => {
    const config = baseConfig({
      getAIConfig: vi.fn().mockResolvedValue({
        defaultModel: 'gpt-4o',
        provider: 'openai',
        requestTimeoutMs: 300000,
      }),
    });

    const runtime = await serviceWith(config).getRuntimeAIConfig({});

    expect(runtime.requestTimeoutMs).toBe(300000);
    expect(config.reportDefaultApplied).not.toHaveBeenCalledWith(
      expect.anything(),
      'requestTimeoutMs',
      expect.anything()
    );
  });

  it('lets a per-run timeout outrank the configured one', async () => {
    const config = baseConfig({
      getAIConfig: vi.fn().mockResolvedValue({
        defaultModel: 'gpt-4o',
        provider: 'openai',
        requestTimeoutMs: 300000,
      }),
    });

    const runtime = await serviceWith(config).getRuntimeAIConfig({
      requestTimeoutMs: 120000,
    });

    expect(runtime.requestTimeoutMs).toBe(120000);
  });

  it('carries a pricing chunk size when no getAIChunkSizes exists', async () => {
    const config = baseConfig({ getAIChunkSizes: undefined });

    const runtime = await serviceWith(config).getRuntimeAIConfig({});

    // The inline literal this replaces listed product, account, order and
    // warehouse - so pricing silently vanished on this path.
    expect(runtime.chunkSizes.pricing).toBe(DEFAULT_CHUNK_SIZES.pricing);
  });

  it('refuses by naming the configuration source, not by naming openai', async () => {
    const config = baseConfig({
      getAIConfig: vi.fn().mockResolvedValue({
        apiKey: 'sk-test',
        aicaFallback: {
          reason: 'no "ai-config" record was found',
          configurationSource: {
            liferayUrl: 'https://lctsolara-uat.lfr.cloud',
            sameAsTarget: true,
          },
        },
      }),
    });

    await expect(serviceWith(config).getRuntimeAIConfig({})).rejects.toThrow(
      /lctsolara-uat\.lfr\.cloud/
    );
  });

  it('still says what a configured instance with no model is missing', async () => {
    const config = baseConfig({
      getAIConfig: vi.fn().mockResolvedValue({ provider: 'anthropic' }),
    });

    await expect(serviceWith(config).getRuntimeAIConfig({})).rejects.toThrow(
      /AI model not configured for provider anthropic/
    );
  });
});
