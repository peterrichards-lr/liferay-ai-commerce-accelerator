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
        sessionCompleted: vi.fn(),
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

    // Wait a tiny bit for background executeNextStep logic to finish
    await new Promise((resolve) => setTimeout(resolve, 200));

    const session = persistence.getSession(sessionId);
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
});
