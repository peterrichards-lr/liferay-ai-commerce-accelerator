const WarehouseGenerator = require('../generators/warehouseGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');

describe('WarehouseGenerator', () => {
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
            name: 'Generated Warehouse',
            country: 'UZ',
            region: 'TOS',
            city: 'Tashkent',
          },
        ]),
      },
      liferay: {
        getCountries: vi.fn().mockResolvedValue([
          {
            id: 1,
            name: 'uzbekistan',
            a2: 'UZ',
            a3: 'UZB',
            active: true,
            title_i18n: { en_US: 'Uzbekistan' },
          },
        ]),
        getCountryRegions: vi.fn().mockResolvedValue([
          {
            id: 101,
            name: 'tashkent',
            regionCode: 'TOS',
            title_i18n: { en_US: 'Tashkent' },
          },
        ]),
        createWarehousesBatch: vi
          .fn()
          .mockResolvedValue({ batchId: 'batch-456' }),
        resolveByERCsWithRetry: vi
          .fn()
          .mockResolvedValue([{ erc: 'WH-1', id: 2001 }]),
      },
      progress: {
        sessionStarted: vi.fn(),
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

    generator = new WarehouseGenerator(mockCtx);
  });

  afterEach(() => {
    persistence.close();
  });

  it('should start warehouse generation workflow', async () => {
    const config = {
      liferayUrl: 'http://test',
      correlationId: 'test-corr-id',
    };
    const options = { warehouseCount: 1 };

    const result = await generator.runWorkflow(config, options);

    expect(result.sessionId).toBeDefined();
    expect(result.message).toContain('started');

    const session = persistence.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session.flow_type).toBe('warehouses');
  });

  it('should store geographicContext with ISO codes in _runWarehouseDataGenerationStep', async () => {
    const sessionId = `wh-test-session-${Date.now()}`;
    persistence.createSession({
      sessionId,
      flowType: 'warehouses',
      status: 'STARTED',
      context: {
        config: { localeCode: 'en-US' },
        options: { warehouseCount: 1 },
        steps: [{ name: 'generate-warehouse-data' }],
      },
    });

    await generator._runWarehouseDataGenerationStep(sessionId);

    const session = persistence.getSession(sessionId);
    expect(session.context.options.geographicContext).toMatchObject({
      countryISOCode: 'UZ',
      regionISOCode: 'TOS',
      countryTitle: 'Uzbekistan',
      regionTitle: 'Tashkent',
    });
  });

  it('should map country and region to ISOCode fields in _runWarehouseCreationStep', async () => {
    const sessionId = `wh-test-session-${Date.now()}`;
    const warehouseDataList = [
      {
        name: 'Test Warehouse',
        country: 'UZ',
        region: 'TOS',
        city: 'Tashkent',
      },
    ];

    persistence.createSession({
      sessionId,
      flowType: 'warehouses',
      status: 'STARTED',
      context: {
        config: {},
        warehouseDataList,
        steps: [{ name: 'create-warehouses' }],
      },
    });

    await generator._runWarehouseCreationStep(sessionId);

    expect(mockCtx.liferay.createWarehousesBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          countryISOCode: 'UZ',
          regionISOCode: 'TOS',
        }),
      ]),
      expect.anything()
    );

    // Verify that the original 'country' and 'region' fields were removed/renamed
    const callArgs = mockCtx.liferay.createWarehousesBatch.mock.calls[0][1];
    expect(callArgs[0]).not.toHaveProperty('country');
    expect(callArgs[0]).not.toHaveProperty('region');
  });
});
