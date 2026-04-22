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
        createAccountsBatch: vi.fn().mockResolvedValue({ id: 'batch-123' }),
        resolveByERCsWithRetry: vi
          .fn()
          .mockResolvedValue([{ erc: 'ACC-1', id: 1001 }]),
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

    const result = await generator.generateAccounts(config, options);

    expect(result.sessionId).toBeDefined();
    expect(result.message).toContain('started');

    const session = persistence.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session.flow_type).toBe('accounts');
    expect(mockCtx.batchCallback._checkSessionCompletion).toHaveBeenCalledWith(
      result.sessionId,
      undefined
    );
  });

  it('should run load countries step', async () => {
    const sessionId = 'test-session';
    persistence.createSession({
      sessionId,
      flowType: 'accounts',
      status: 'STARTED',
      context: { config: {} },
    });

    await generator._runLoadCountriesStep(sessionId);

    const session = persistence.getSession(sessionId);
    expect(session.context.countries).toHaveLength(1);
    expect(mockCtx.liferay.getCountries).toHaveBeenCalled();
  });

  it('should run data generation step', async () => {
    const sessionId = 'test-session';
    persistence.createSession({
      sessionId,
      flowType: 'accounts',
      status: 'STARTED',
      context: {
        config: {},
        options: { accountCount: 1 },
        countries: [{ id: 1, name: 'US' }],
      },
    });

    await generator._runAccountDataGenerationStep(sessionId);

    const session = persistence.getSession(sessionId);
    expect(session.context.accountsToCreate).toHaveLength(1);
    expect(session.context.accountsToCreate[0].name).toBe('Generated Account');
    expect(mockCtx.generation.generateData).toHaveBeenCalled();
  });
});
