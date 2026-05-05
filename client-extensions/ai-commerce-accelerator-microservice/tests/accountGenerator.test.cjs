const AccountGenerator = require('../generators/accountGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');

describe('AccountGenerator', () => {
  let generator;
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
      },
      generation: {
        generateData: vi.fn().mockResolvedValue([
          {
            name: 'Generated Account',
            headOfficeAddress: {
              addressLocality: 'Test City',
              postalCode: '12345',
            },
          },
        ]),
      },
      liferay: {
        getCountries: vi.fn().mockResolvedValue([{ id: 1, name: 'US' }]),
        getCountryRegions: vi
          .fn()
          .mockResolvedValue([{ id: 10, name: 'California' }]),
        createAccountsBatch: vi
          .fn()
          .mockResolvedValue({ batchId: 'batch-123' }),
        resolveByERCsWithRetry: vi
          .fn()
          .mockResolvedValue([{ erc: 'ACC-1', id: 1001 }]),
      },
      progress: {
        stepStarted: vi.fn(),
        stepProgress: vi.fn(),
        stepFailed: vi.fn(),
        batchStarted: vi.fn(),
        batchProgress: vi.fn(),
        batchCompleted: vi.fn(),
        batchFailed: vi.fn(),
        sessionCompleted: vi.fn(),
        sessionFailed: vi.fn(),
      },
      batchCallback: {
        _checkSessionCompletion: vi.fn(),
      },
    };

    generator = new AccountGenerator(mockCtx);
  });

  afterEach(() => {
    persistence.close();
  });

  it('should start account generation workflow', async () => {
    const config = { liferayUrl: 'http://test' };
    const options = { accountCount: 1 };

    const result = await generator.runWorkflow(config, options);

    expect(result.sessionId).toBeDefined();
    expect(result.message).toContain('started');

    const session = persistence.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session.flow_type).toBe('accounts');
    expect(mockCtx.batchCallback._checkSessionCompletion).toHaveBeenCalled();
  });
  it('should run load countries step', async () => {
    const sessionId = `test-session-${Date.now()}`;
    persistence.createSession({
      sessionId,
      flowType: 'accounts',
      status: 'STARTED',
      context: { config: {}, steps: [{ name: 'load-countries' }] },
    });

    await generator._runLoadCountriesStep(sessionId);

    // Wait for the session to reach a terminal state
    let session = persistence.getSession(sessionId);
    let attempts = 0;
    while (session.status !== 'COMPLETED' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      session = persistence.getSession(sessionId);
      attempts++;
    }

    expect(session.context.countries).toHaveLength(1);
    expect(session.status).toBe('COMPLETED');
    expect(mockCtx.liferay.getCountries).toHaveBeenCalled();
  });

  it('should run data generation step', async () => {
    const sessionId = `acc-test-session-${Date.now()}`;
    persistence.createSession({
      sessionId,
      flowType: 'accounts',
      status: 'STARTED',
      context: {
        config: {},
        options: { accountCount: 1 },
        countries: [{ id: 1, name: 'US' }],
        steps: [{ name: 'generate-account-data' }],
      },
    });

    await generator._runAccountDataGenerationStep(sessionId);

    const session = persistence.getSession(sessionId);
    expect(session.context.accountsToCreate).toHaveLength(1);
    expect(session.context.accountsToCreate[0].name).toBe('Generated Account');
    expect(mockCtx.generation.generateData).toHaveBeenCalled();
  });

  it('should match country correctly in _generateAddress', async () => {
    const countries = [
      {
        id: 1,
        name: 'spain',
        a2: 'ES',
        a3: 'ESP',
        active: true,
        title_i18n: { en_US: 'Spain' },
      },
      {
        id: 2,
        name: 'thailand',
        a2: 'TH',
        a3: 'THA',
        active: true,
        title_i18n: { en_US: 'Thailand' },
      },
    ];
    const rawAddress = {
      addressCountry: 'thailand',
      addressLocality: 'Bangkok',
    };
    const config = { localeCode: 'en-US' };

    const address = await generator._generateAddress(
      'billing',
      config,
      rawAddress,
      countries,
      'test-session'
    );

    expect(address.addressCountry).toBe('Thailand');
    expect(mockCtx.liferay.getCountryRegions).toHaveBeenCalledWith(config, 2);
  });

  it('should use geographicContext titles if provided in _generateAddress', async () => {
    const countries = [];
    const rawAddress = {
      addressLocality: 'Bangkok',
    };
    const config = { localeCode: 'en-US' };
    const geographicContext = {
      countryTitle: 'Uzbekistan',
      regionTitle: 'Tashkent',
    };

    const address = await generator._generateAddress(
      'billing',
      config,
      rawAddress,
      countries,
      'test-session',
      geographicContext
    );

    expect(address.addressCountry).toBe('Uzbekistan');
    expect(address.addressRegion).toBe('Tashkent');
    expect(address.addressLocality).toBe('Bangkok');
  });

  it('should use country title from title_i18n in _runAccountDataGenerationStep', async () => {
    const sessionId = `acc-test-session-${Date.now()}`;
    const countries = [
      {
        id: 1,
        name: 'uzbekistan',
        a2: 'UZ',
        a3: 'UZB',
        active: true,
        title_i18n: { en_US: 'Uzbekistan' },
      },
    ];
    const regions = [
      {
        id: 101,
        name: 'tashkent',
        regionCode: 'TOS',
        title_i18n: { en_US: 'Tashkent' },
      },
    ];

    mockCtx.liferay.getCountryRegions.mockResolvedValue(regions);

    persistence.createSession({
      sessionId,
      flowType: 'accounts',
      status: 'STARTED',
      context: {
        config: { localeCode: 'en-US' },
        options: { accountCount: 1 },
        countries,
        steps: [{ name: 'generate-account-data' }],
      },
    });

    await generator._runAccountDataGenerationStep(sessionId);

    const session = persistence.getSession(sessionId);
    // Verify that geographicContext was stored with titles
    expect(session.context.geographicContext).toMatchObject({
      countryTitle: 'Uzbekistan',
      regionTitle: 'Tashkent',
    });
  });
});
