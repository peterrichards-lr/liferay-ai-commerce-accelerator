const {
  DEFAULTED,
  STALE,
  UNAVAILABLE,
  UNCHECKED,
  VERIFIED,
  classifyCommerceSelection,
  describeCommerceSelection,
  resolveRunCommerceSelection,
} = require('../utils/commerceSelection.cjs');
const generateRoute = require('../routes/generate.cjs');

const CATALOGS = [
  { id: 102, name: 'Spare Parts' },
  { id: 205, name: 'Accessories' },
];

const CHANNELS = [
  { id: 301, name: 'Web Store', siteGroupId: 900 },
  { id: 402, name: 'Trade Counter', siteGroupId: 901 },
];

const makeLogger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
});

describe('classifyCommerceSelection', () => {
  it('verifies a requested id that the list contains', () => {
    const result = classifyCommerceSelection({
      items: CATALOGS,
      requestedId: 205,
    });

    expect(result.outcome).toBe(VERIFIED);
    expect(result.id).toBe(205);
    expect(result.item).toBe(CATALOGS[1]);
  });

  it('matches a numeric id supplied as a string', () => {
    expect(
      classifyCommerceSelection({ items: CATALOGS, requestedId: '102' }).outcome
    ).toBe(VERIFIED);
  });

  it('reports a requested id the list does not contain as stale', () => {
    const result = classifyCommerceSelection({
      items: CATALOGS,
      requestedId: 34205,
    });

    expect(result.outcome).toBe(STALE);
    expect(result.id).toBe(34205);
    expect(result.item).toBeNull();
  });

  it('defaults to the first entry when no id was requested', () => {
    const result = classifyCommerceSelection({
      items: CATALOGS,
      requestedId: null,
    });

    expect(result.outcome).toBe(DEFAULTED);
    expect(result.id).toBe(102);
  });

  it('treats a NaN id as no id rather than as a stale one', () => {
    expect(
      classifyCommerceSelection({ items: CATALOGS, requestedId: 'abc' }).outcome
    ).toBe(DEFAULTED);
  });

  it('has nothing to fall back to when the list is empty', () => {
    const result = classifyCommerceSelection({ items: [], requestedId: null });

    expect(result.outcome).toBe(UNAVAILABLE);
    expect(result.id).toBeNull();
  });

  it('calls an empty list evidence but an unreadable list nothing at all', () => {
    expect(
      classifyCommerceSelection({ items: [], requestedId: 34205 }).outcome
    ).toBe(STALE);

    const unreadable = classifyCommerceSelection({
      items: null,
      requestedId: 34205,
    });

    expect(unreadable.outcome).toBe(UNCHECKED);
    expect(unreadable.id).toBe(34205);
  });
});

describe('describeCommerceSelection', () => {
  it('names the requested id and refuses on a stale one', () => {
    const { level, message } = describeCommerceSelection({
      id: 34205,
      item: null,
      label: 'Catalog',
      outcome: STALE,
    });

    expect(level).toBe('error');
    expect(message).toContain('Catalog id 34205 does not exist');
    expect(message).toContain('Refusing the run');
  });

  it('names the substitute when it defaults', () => {
    const { level, message } = describeCommerceSelection({
      candidateCount: 2,
      id: 102,
      item: CATALOGS[0],
      label: 'Catalog',
      outcome: DEFAULTED,
    });

    expect(level).toBe('info');
    expect(message).toContain("Defaulting to 'Spare Parts' (id 102)");
    expect(message).toContain('the first of 2');
  });

  it('names the entity a verified run is using', () => {
    expect(
      describeCommerceSelection({
        id: 301,
        item: CHANNELS[0],
        label: 'Channel',
        outcome: VERIFIED,
      }).message
    ).toBe("Channel 'Web Store' (id 301) confirmed.");
  });

  it('flattens a localised name', () => {
    expect(
      describeCommerceSelection({
        id: 7,
        item: { id: 7, name: { en_US: 'Localised' } },
        label: 'Catalog',
        outcome: VERIFIED,
      }).message
    ).toContain("'Localised'");
  });

  it('says an unreadable list left the supplied id unchecked', () => {
    const { level, message } = describeCommerceSelection({
      id: 34205,
      item: null,
      label: 'Catalog',
      outcome: UNCHECKED,
    });

    expect(level).toBe('warn');
    expect(message).toContain('could not be checked');
    expect(message).toContain('used as supplied');
  });
});

describe('resolveRunCommerceSelection', () => {
  const liferayService = (overrides = {}) => ({
    getCatalog: vi.fn().mockRejectedValue(new Error('404')),
    getCatalogs: vi.fn().mockResolvedValue(CATALOGS),
    getChannels: vi.fn().mockResolvedValue(CHANNELS),
    ...overrides,
  });

  it('leaves a valid pair untouched and reports what the run will use', async () => {
    const config = { catalogId: 205, channelId: 402, siteGroupId: 901 };

    const result = await resolveRunCommerceSelection({
      config,
      liferayService: liferayService(),
      logger: makeLogger(),
    });

    expect(result.rejection).toBeNull();
    expect(config.catalogId).toBe(205);
    expect(config.channelId).toBe(402);
    expect(result.summary).toEqual({
      catalogId: 205,
      catalogName: 'Accessories',
      channelId: 402,
      channelName: 'Trade Counter',
      siteGroupId: 901,
    });
  });

  it('refuses the run on a stale catalog rather than moving it', async () => {
    const config = { catalogId: 34205, channelId: 301 };

    const result = await resolveRunCommerceSelection({
      config,
      liferayService: liferayService(),
      logger: makeLogger(),
    });

    expect(result.rejection).toContain('Catalog id 34205 does not exist');
    expect(config.catalogId).toBe(34205);
    expect(result.rejections).toHaveLength(1);
  });

  it('refuses on a stale channel and names both when both are stale', async () => {
    const result = await resolveRunCommerceSelection({
      config: { catalogId: 34205, channelId: 34907 },
      liferayService: liferayService(),
      logger: makeLogger(),
    });

    expect(result.rejections).toHaveLength(2);
    expect(result.rejection).toContain('Channel id 34907');
    expect(result.rejection).toContain('Catalog id 34205');
  });

  it('accepts an id the list did not carry but the instance confirms by id', async () => {
    const config = { catalogId: 5000, channelId: 301 };

    const service = liferayService({
      getCatalog: vi.fn().mockResolvedValue({ id: 5000, name: 'Page Two' }),
    });

    const result = await resolveRunCommerceSelection({
      config,
      liferayService: service,
      logger: makeLogger(),
    });

    expect(service.getCatalog).toHaveBeenCalledWith(config, 5000);
    expect(result.rejection).toBeNull();
    expect(result.summary.catalogName).toBe('Page Two');
  });

  it('confirms a channel by id through the generated client', async () => {
    const getChannel = vi
      .fn()
      .mockResolvedValue({ id: 5001, name: 'Page Two', siteGroupId: 950 });

    const config = { catalogId: 102, channelId: 5001 };

    const result = await resolveRunCommerceSelection({
      config,
      liferayService: liferayService({
        client: { headlessCommerceAdminChannel: { v1_0: { getChannel } } },
      }),
      logger: makeLogger(),
    });

    expect(getChannel).toHaveBeenCalledWith(config, 5001);
    expect(result.rejection).toBeNull();
    expect(config.siteGroupId).toBe(950);
  });

  it('fills in both ids when none were requested and says which it chose', async () => {
    const config = {};

    const result = await resolveRunCommerceSelection({
      config,
      liferayService: liferayService(),
      logger: makeLogger(),
    });

    expect(config.catalogId).toBe(102);
    expect(config.channelId).toBe(301);
    expect(config.siteGroupId).toBe(900);
    expect(result.logs.map(({ message }) => message).join(' ')).toContain(
      'Defaulting to'
    );
  });

  it('uses the ids as supplied when the lists cannot be read', async () => {
    const config = { catalogId: 34205, channelId: 34907 };
    const logger = makeLogger();

    const result = await resolveRunCommerceSelection({
      config,
      liferayService: liferayService({
        getCatalogs: vi.fn().mockRejectedValue(new Error('offline')),
        getChannels: vi.fn().mockRejectedValue(new Error('offline')),
      }),
      logger,
    });

    expect(result.rejection).toBeNull();
    expect(config.catalogId).toBe(34205);
    expect(config.channelId).toBe(34907);
    expect(logger.error).toHaveBeenCalled();
  });

  it("prefers the channel's own siteGroupId over a stale one in the request", async () => {
    const config = { catalogId: 102, channelId: 301, siteGroupId: 99999 };

    const result = await resolveRunCommerceSelection({
      config,
      liferayService: liferayService(),
      logger: makeLogger(),
    });

    expect(config.siteGroupId).toBe(900);
    expect(result.logs.map(({ message }) => message).join(' ')).toContain(
      'is not the site of channel 301'
    );
  });
});

describe('Generation route commerce guard', () => {
  let routeHandler;
  let createSession;
  let logger;
  let liferayService;

  const post = async (body) => {
    const req = {
      body: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        imageMode: 'placeholder',
        liferayUrl: 'http://localhost:8080',
        pdfMode: 'placeholder',
        productCount: 1,
        ...body,
      },
      correlationId: 'corr-1',
      files: {},
      headers: {},
    };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await routeHandler(req, res);

    return res;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    createSession = vi.fn().mockResolvedValue({});
    logger = makeLogger();
    liferayService = {
      getCatalog: vi.fn().mockRejectedValue(new Error('404')),
      getCatalogs: vi.fn().mockResolvedValue(CATALOGS),
      getChannels: vi.fn().mockResolvedValue(CHANNELS),
    };

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
        batchCallbackService: { _checkSessionCompletion: vi.fn() },
        commerceSiteTypeService: { getChannelSiteType: vi.fn() },
        configService: {
          getAIConfig: vi.fn().mockResolvedValue({ apiKey: 'key' }),
          getAIKey: vi.fn().mockResolvedValue('key'),
        },
        liferayService,
        logger,
        persistenceService: { createSession },
        progressService: { emitError: vi.fn(), sessionStarted: vi.fn() },
      }
    );
  });

  it('refuses a run whose catalog no longer exists', async () => {
    const res = await post({ catalogId: 34205, channelId: 301 });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Catalog id 34205 does not exist'),
        success: false,
      })
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it('names the catalog and channel the run actually used', async () => {
    const res = await post({ catalogId: 205, channelId: 402 });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        commerce: {
          catalogId: 205,
          catalogName: 'Accessories',
          channelId: 402,
          channelName: 'Trade Counter',
          siteGroupId: 901,
        },
        success: true,
      })
    );
  });

  it('guards a seed pack run, which used to return before the fallback ran', async () => {
    const res = await post({
      catalogId: 34205,
      channelId: 301,
      seedPack: 'industrial-power-tools',
    });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createSession).not.toHaveBeenCalled();
  });
});
