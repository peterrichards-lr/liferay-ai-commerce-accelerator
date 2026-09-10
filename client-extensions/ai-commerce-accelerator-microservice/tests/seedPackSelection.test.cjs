/**
 * The seed pack an operator picks is now the pack that runs.
 *
 * `seedPack` never survived normalisation, so the selector in the dashboard
 * chose nothing: a run with a pack selected went down the AI path instead, and
 * the only way to reach a seed pack at all was to have no AI key configured -
 * which forced 'industrial-power-tools' whatever the operator had chosen. See
 * #696.
 */
const generateRoute = require('../routes/generate.cjs');

const buildRoute = ({ aiKeyAvailable = true } = {}) => {
  let routeHandler;
  const createSession = vi.fn().mockResolvedValue({});

  generateRoute(
    {
      // Positional capture would take a middleware now that the write
      // routes guard their target; the terminal handler is always last.
      // See #815.
      post: vi.fn().mockImplementation((_path, ...handlers) => {
        routeHandler = handlers[handlers.length - 1];
      }),
    },
    {
      liferayService: {
        getChannels: vi.fn().mockResolvedValue([{ id: 1, siteGroupId: 2 }]),
        getCatalogs: vi.fn().mockResolvedValue([{ id: 3 }]),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      progressService: { sessionStarted: vi.fn(), emitError: vi.fn() },
      persistenceService: { createSession },
      batchCallbackService: { _checkSessionCompletion: vi.fn() },
      configService: {
        getAIConfig: vi
          .fn()
          .mockResolvedValue(aiKeyAvailable ? { apiKey: 'test-key' } : {}),
        getAIKey: vi.fn().mockResolvedValue(aiKeyAvailable ? 'test-key' : null),
        getGenerationLimits: vi.fn().mockResolvedValue({}),
        getBatchSizes: vi.fn().mockResolvedValue([]),
        getAIModelOptions: vi.fn().mockResolvedValue({}),
      },
      commerceSiteTypeService: null,
    }
  );

  const run = async (body) => {
    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        channelId: '1',
        siteGroupId: '2',
        catalogId: '3',
        ...body,
      },
      files: {},
      headers: { 'x-correlation-id': 'corr-1' },
      correlationId: 'corr-1',
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await routeHandler(req, res);

    return { res, createSession };
  };

  return { run, createSession };
};

describe('Seed pack selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it('runs the pack the operator chose', async () => {
    const { run } = buildRoute();
    const { res, createSession } = await run({
      seedPack: 'outdoor-adventure-gear',
      productCount: '0',
      accountCount: '0',
      orderCount: '0',
    });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );

    const { context } = createSession.mock.calls[0][0];
    expect(context.options.seedPack).toBe('outdoor-adventure-gear');
    expect(context.productDataList.length).toBeGreaterThan(0);
  });

  it('does not divert a run that chose no pack', async () => {
    const { run } = buildRoute();
    const { createSession } = await run({
      productCount: '2',
      accountCount: '0',
      orderCount: '0',
    });

    const { context, flowType } = createSession.mock.calls[0][0];
    expect(flowType).toBe('generate');
    expect(context.productDataList).toBeUndefined();
  });

  it('keeps the chosen pack when there is no AI key to fall back from', async () => {
    const { run } = buildRoute({ aiKeyAvailable: false });
    const { createSession } = await run({
      seedPack: 'outdoor-adventure-gear',
      productCount: '0',
      accountCount: '0',
      orderCount: '0',
    });

    const { context } = createSession.mock.calls[0][0];
    expect(context.options.seedPack).toBe('outdoor-adventure-gear');
  });

  it('still falls back to a default pack when no key and no choice', async () => {
    const { run } = buildRoute({ aiKeyAvailable: false });
    const { createSession } = await run({
      productCount: '0',
      accountCount: '0',
      orderCount: '0',
    });

    const { context } = createSession.mock.calls[0][0];
    expect(context.options.seedPack).toBe('industrial-power-tools');
  });

  it('rejects a pack name that tries to escape the seed pack directory', async () => {
    const { run } = buildRoute();
    const { res } = await run({
      seedPack: '../../../package',
      productCount: '0',
      accountCount: '0',
      orderCount: '0',
    });

    // Rejected by the schema rule, before the route ever builds a path. The
    // basename in generate.cjs is the second line of defence, not the first.
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        details: expect.arrayContaining([
          expect.stringContaining('seedPack format is invalid'),
        ]),
      })
    );
  });
});
