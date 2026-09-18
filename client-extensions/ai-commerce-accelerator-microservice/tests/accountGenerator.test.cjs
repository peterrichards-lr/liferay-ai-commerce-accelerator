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
        sessionStarted: vi.fn(),
        sessionCompleted: vi.fn(),
        sessionFailed: vi.fn(),
        stepStarted: vi.fn(),
        stepProgress: vi.fn(),
        stepCompleted: vi.fn(),
        stepFailed: vi.fn(),
        batchStarted: vi.fn(),
        batchProgress: vi.fn(),
        batchCompleted: vi.fn(),
        batchFailed: vi.fn(),
      },
      batchCallback: {
        _checkSessionCompletion: vi
          .fn()
          .mockImplementation((sid) => generator.executeNextStep(sid)),
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

    const session = await persistence.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session.flow_type).toBe('accounts');
    expect(mockCtx.batchCallback._checkSessionCompletion).toHaveBeenCalled();
  });
  it('should run load countries step', async () => {
    const sessionId = `test-session-${Date.now()}`;
    await persistence.createSession({
      sessionId,
      flowType: 'accounts',
      status: 'STARTED',
      context: { config: {}, steps: [{ name: 'load-countries' }] },
    });

    await generator._runLoadCountriesStep(sessionId);
    await generator.executeNextStep(sessionId);

    const session = await persistence.getSession(sessionId);
    expect(session.context.countries).toHaveLength(1);
    expect(session.status).toBe('COMPLETED');
    expect(mockCtx.liferay.getCountries).toHaveBeenCalled();
  });

  it('should run data generation step', async () => {
    const sessionId = `acc-test-session-${Date.now()}`;
    await persistence.createSession({
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

    const session = await persistence.getSession(sessionId);
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

  // The model returns a street with the city and postcode it chose, and it was
  // discarded in favour of randomString(8) - so a demo account showed
  // "822 fiiqbmgf Road, London, W1D 3QJ" (#826).
  it('should keep the street the model supplied in _generateAddress', async () => {
    const rawAddress = {
      streetAddressLine1: '399 Camden High Street',
      addressLocality: 'London',
      postalCode: 'W1D 3QJ',
    };

    const address = await generator._generateAddress(
      'billing',
      { localeCode: 'en-US' },
      rawAddress,
      [],
      'test-session',
      { countryTitle: 'United Kingdom', regionTitle: 'Greater London' }
    );

    expect(address.streetAddressLine1).toBe('399 Camden High Street');
  });

  it('should generate a plausible street when the model named none', async () => {
    const address = await generator._generateAddress(
      'shipping',
      { localeCode: 'en-US' },
      { addressLocality: 'London', postalCode: 'W1D 3QJ' },
      [],
      'test-session',
      { countryTitle: 'United Kingdom', regionTitle: 'Greater London' }
    );

    expect(address.streetAddressLine1).toMatch(
      /^\d{1,3} [A-Z][a-z]+ (Street|Avenue|Road|Lane)$/
    );
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

    await persistence.createSession({
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

    const session = await persistence.getSession(sessionId);
    // Verify that geographicContext was stored with titles inside options
    expect(session.context.options.geographicContext).toMatchObject({
      countryTitle: 'Uzbekistan',
      regionTitle: 'Tashkent',
    });
  });
  describe('create-addresses on a second attempt (#895)', () => {
    const addressSession = async (sessionId) => {
      await persistence.createSession({
        sessionId,
        flowType: 'accounts',
        status: 'STARTED',
        context: {
          config: {},
          options: {},
          accountsToCreate: [{ externalReferenceCode: 'ACC-1', id: 1001 }],
          addressesToCreate: [
            {
              accountERC: 'ACC-1',
              name: 'Head Office',
              city: 'Reading',
              streetAddressLine1: '1 Kings Road',
            },
            {
              accountERC: 'ACC-1',
              name: 'Warehouse',
              city: 'Slough',
              streetAddressLine1: '2 Trading Estate',
            },
          ],
          steps: [{ name: 'create-addresses' }],
        },
      });
    };

    const ercsSent = () =>
      mockCtx.liferay.createAccountAddressBatch.mock.calls.flatMap(
        ([, , addresses]) =>
          addresses.map((address) => address.externalReferenceCode)
      );

    beforeEach(() => {
      mockCtx.liferay.createAccountAddressBatch = vi
        .fn()
        .mockResolvedValue({ batchId: 'batch-addr' });
      generator.submitBatch = vi
        .fn()
        .mockImplementation(async (_sessionId, _step, _kind, _op, send) => {
          await send('BATCH-ERC');
        });
    });

    it('sends the same external reference codes every time', async () => {
      // The step used to mint `createERC(ERC_PREFIX.ADDRESS)` per attempt and
      // never write it back to the context, so the batch upsert had a fresh
      // key on every run. A resumed import would have given each account its
      // addresses twice, with nothing failing to say so.
      await addressSession('first');
      await generator._runAddressCreationStep('first');
      const first = ercsSent();

      await addressSession('second');
      await generator._runAddressCreationStep('second');
      const second = ercsSent().slice(first.length);

      expect(first).toHaveLength(2);
      expect(second).toEqual(first);
    });

    it('gives two addresses of one account different codes', async () => {
      // Derived, not random - so the derivation has to separate them itself.
      await addressSession('first');
      await generator._runAddressCreationStep('first');

      const [one, two] = ercsSent();

      expect(one).not.toEqual(two);
    });

    it('separates two addresses that are otherwise identical', async () => {
      // Which is why the derivation includes the address's position in the
      // list. Collapsing a genuine duplicate into one row would be silent data
      // loss of exactly the kind this change is meant to remove.
      await addressSession('first');
      const session = await persistence.getSession('first');
      session.context.addressesToCreate[1] = {
        ...session.context.addressesToCreate[0],
      };
      await persistence.updateSessionContext('first', {
        addressesToCreate: session.context.addressesToCreate,
      });

      await generator._runAddressCreationStep('first');

      const [one, two] = ercsSent();

      expect(one).not.toEqual(two);
    });

    it('keeps a code the dataset supplied rather than deriving over it', async () => {
      await addressSession('first');
      const session = await persistence.getSession('first');
      session.context.addressesToCreate[0].externalReferenceCode =
        'FROM-SOURCE';
      await persistence.updateSessionContext('first', {
        addressesToCreate: session.context.addressesToCreate,
      });

      await generator._runAddressCreationStep('first');

      expect(ercsSent()).toContain('FROM-SOURCE');
    });
  });
});
