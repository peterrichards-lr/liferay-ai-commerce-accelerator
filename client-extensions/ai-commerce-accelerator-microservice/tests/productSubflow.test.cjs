const fs = require('fs');
const path = require('path');
const generateRoute = require('../routes/generate.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const {
  pricingSteps,
  specificationSteps,
  warehouseCreationSteps,
} = require('../utils/productSubflow.cjs');

const S = WORKFLOW_STEPS;

const flattenStepNames = (steps) =>
  steps.flatMap((step) =>
    Array.isArray(step.steps) ? flattenStepNames(step.steps) : [step.name]
  );

describe('warehouseCreationSteps', () => {
  it('creates warehouses when asked for a positive number of them', () => {
    expect(
      warehouseCreationSteps({ createWarehouses: true, warehouseCount: 5 })
    ).toEqual([
      { name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' },
      { name: S.CREATE_WAREHOUSES, type: 'sync' },
      { name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' },
    ]);
  });

  it.each([
    ['the toggle is off', { createWarehouses: false, warehouseCount: 5 }],
    ['no warehouses are asked for', { createWarehouses: true }],
    [
      'zero warehouses are asked for',
      { createWarehouses: true, warehouseCount: 0 },
    ],
    ['nothing was said at all', {}],
  ])('creates none when %s', (_label, options) => {
    expect(warehouseCreationSteps(options)).toEqual([]);
  });

  it('never includes the channel link, which is not creation', () => {
    expect(
      warehouseCreationSteps({ createWarehouses: true, warehouseCount: 1 })
    ).not.toContainEqual({ name: S.LINK_WAREHOUSE_CHANNELS, type: 'sync' });
  });
});

describe('specificationSteps', () => {
  it('registers specifications when the toggle is on', () => {
    expect(specificationSteps({ generateSpecifications: true })).toEqual([
      { name: S.ENSURE_SPECIFICATION_CATEGORIES, type: 'sync' },
      { name: S.ENSURE_SPECIFICATIONS, type: 'sync' },
    ]);
  });

  it.each([
    ['the toggle is off', { generateSpecifications: false }],
    ['nothing was said at all', {}],
  ])('registers none when %s', (_label, options) => {
    expect(specificationSteps(options)).toEqual([]);
  });
});

describe('pricingSteps', () => {
  it('writes prices only when the toggle is on', () => {
    expect(pricingSteps({ generatePriceLists: true })).toEqual([
      { name: S.GENERATE_PRICE_LISTS, type: 'sync' },
      { name: S.UPDATE_CATALOG_CONFIG, type: 'sync' },
    ]);
  });

  it.each([
    ['the toggle is off', { generatePriceLists: false }],
    ['nothing was said at all', {}],
  ])('writes no price entries when %s', (_label, options) => {
    expect(pricingSteps(options)).not.toContainEqual({
      name: S.GENERATE_PRICE_LISTS,
      type: 'sync',
    });
  });

  it('adds the bulk and tier steps the form nests under the toggle', () => {
    expect(
      pricingSteps({
        generatePriceLists: true,
        generateBulkPricing: true,
        generateTierPricing: true,
      })
    ).toEqual([
      { name: S.GENERATE_PRICE_LISTS, type: 'sync' },
      { name: S.UPDATE_CATALOG_CONFIG, type: 'sync' },
      { name: S.GENERATE_BULK_PRICING, type: 'sync' },
      { name: S.GENERATE_TIER_PRICING, type: 'sync' },
    ]);
  });

  it('drops the nested bulk and tier steps with their parent', () => {
    expect(
      pricingSteps({
        generatePriceLists: false,
        generateBulkPricing: true,
        generateTierPricing: true,
      })
    ).toEqual([{ name: S.UPDATE_CATALOG_CONFIG, type: 'sync' }]);
  });

  it('always keeps the catalog pointed at its own base price list', () => {
    for (const options of [
      { generatePriceLists: true },
      { generatePriceLists: false },
      {},
    ]) {
      expect(pricingSteps(options)).toContainEqual({
        name: S.UPDATE_CATALOG_CONFIG,
        type: 'sync',
      });
    }
  });
});

describe('Generation toggles gate the steps they name', () => {
  let routeHandler;
  let createSession;

  const allOn = {
    productCount: '5',
    accountCount: '0',
    orderCount: '0',
    createWarehouses: 'true',
    warehouseCount: '5',
    generateSpecifications: 'true',
  };

  const runRoute = async (options) => {
    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        channelId: '1',
        siteGroupId: '2',
        catalogId: '3',
        ...options,
      },
      files: {},
      headers: { 'x-correlation-id': 'corr-1' },
      correlationId: 'corr-1',
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await routeHandler(req, res);

    return flattenStepNames(createSession.mock.calls.at(-1)[0].context.steps);
  };

  beforeEach(() => {
    vi.clearAllMocks();

    createSession = vi.fn().mockResolvedValue({});

    const mockApp = {
      post: vi.fn().mockImplementation((_path, _upload, handler) => {
        routeHandler = handler;
      }),
    };

    generateRoute(mockApp, {
      liferayService: {
        getChannels: vi.fn().mockResolvedValue([{ id: 1, siteGroupId: 2 }]),
        getCatalogs: vi.fn().mockResolvedValue([{ id: 3 }]),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      progressService: { sessionStarted: vi.fn(), emitError: vi.fn() },
      persistenceService: { createSession },
      batchCallbackService: { _checkSessionCompletion: vi.fn() },
      // Without a resolvable AI key the route diverts to the seed-pack flow.
      configService: {
        getAIConfig: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
        getAIKey: vi.fn().mockResolvedValue('test-key'),
      },
      commerceSiteTypeService: null,
    });
  });

  it('creates warehouses only when asked to', async () => {
    expect(await runRoute(allOn)).toEqual(
      expect.arrayContaining([
        S.GENERATE_WAREHOUSE_DATA,
        S.CREATE_WAREHOUSES,
        S.RESOLVE_WAREHOUSE_IDS,
      ])
    );

    const off = await runRoute({ ...allOn, createWarehouses: 'false' });

    expect(off).not.toContain(S.GENERATE_WAREHOUSE_DATA);
    expect(off).not.toContain(S.CREATE_WAREHOUSES);
    expect(off).not.toContain(S.RESOLVE_WAREHOUSE_IDS);
  });

  it('still gives the run channels their warehouses when it creates none', async () => {
    const off = await runRoute({ ...allOn, createWarehouses: 'false' });

    expect(off).toContain(S.LINK_WAREHOUSE_CHANNELS);
    expect(off).toContain(S.UPDATE_INVENTORY);
  });

  it('registers specifications only when asked to', async () => {
    expect(await runRoute(allOn)).toEqual(
      expect.arrayContaining([
        S.ENSURE_SPECIFICATION_CATEGORIES,
        S.ENSURE_SPECIFICATIONS,
      ])
    );

    const off = await runRoute({ ...allOn, generateSpecifications: 'false' });

    expect(off).not.toContain(S.ENSURE_SPECIFICATION_CATEGORIES);
    expect(off).not.toContain(S.ENSURE_SPECIFICATIONS);
    expect(off).toContain(S.ENSURE_CATEGORIES);
    expect(off).toContain(S.ENSURE_OPTIONS);
  });

  it('writes price entries only when asked to', async () => {
    expect(
      await runRoute({
        ...allOn,
        generatePriceLists: 'true',
        generateBulkPricing: 'true',
        generateTierPricing: 'true',
      })
    ).toEqual(
      expect.arrayContaining([
        S.GENERATE_PRICE_LISTS,
        S.GENERATE_BULK_PRICING,
        S.GENERATE_TIER_PRICING,
      ])
    );

    const off = await runRoute({
      ...allOn,
      generatePriceLists: 'false',
      generateBulkPricing: 'true',
      generateTierPricing: 'true',
    });

    expect(off).not.toContain(S.GENERATE_PRICE_LISTS);
    expect(off).not.toContain(S.GENERATE_BULK_PRICING);
    expect(off).not.toContain(S.GENERATE_TIER_PRICING);
    expect(off).toContain(S.UPDATE_CATALOG_CONFIG);
  });

  it('leaves the rest of the product subflow alone when everything is off', async () => {
    const off = await runRoute({
      ...allOn,
      createWarehouses: 'false',
      generateSpecifications: 'false',
    });

    expect(off).toEqual([
      S.LINK_WAREHOUSE_CHANNELS,
      S.GENERATE_PRODUCT_DATA,
      S.ENSURE_CATEGORIES,
      S.ENSURE_OPTIONS,
      S.CREATE_PRODUCTS,
      S.RESOLVE_PRODUCT_IDS,
      S.LINK_PRODUCT_OPTIONS,
      S.CREATE_PRODUCT_SKUS,
      S.RESOLVE_SKU_IDS,
      S.SYNC_DELAY_PRICING,
      S.UPDATE_CATALOG_CONFIG,
      S.UPDATE_INVENTORY,
      S.ATTACH_IMAGES,
      S.ATTACH_PDFS,
    ]);
  });

  it('leaves a run that only places orders to the channel backfill', async () => {
    const steps = await runRoute({
      productCount: '0',
      accountCount: '0',
      orderCount: '10',
      createWarehouses: 'true',
      warehouseCount: '5',
      generateSpecifications: 'true',
    });

    expect(steps).toEqual([
      S.LINK_PRODUCT_CHANNELS,
      S.LINK_WAREHOUSE_CHANNELS,
      S.GENERATE_ORDER_DATA,
      S.CREATE_ORDERS,
    ]);
  });
});

describe('Generated product data honours generateSpecifications', () => {
  const runDataGeneration = async (options) => {
    const persistence = {
      getSession: vi.fn().mockResolvedValue({
        session_id: 'sess-1',
        correlationId: 'corr-1',
        context: { config: { catalogId: '3' }, options },
      }),
      updateSessionContext: vi.fn().mockResolvedValue({}),
      createBatch: vi.fn().mockResolvedValue({}),
    };

    const generator = new ProductGenerator({
      liferay: {},
      persistence,
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      progress: { batchStarted: vi.fn(), batchCompleted: vi.fn() },
      generation: {
        generateData: vi.fn().mockResolvedValue([
          {
            name: { en_US: 'Product 1' },
            specifications: [{ specificationKey: 'colour', value: 'red' }],
          },
        ]),
      },
    });
    generator.completeSyncStep = vi.fn().mockResolvedValue({});

    await generator.steps[S.GENERATE_PRODUCT_DATA]('sess-1');

    return persistence.updateSessionContext.mock.calls.at(-1)[1]
      .productDataList[0];
  };

  it('keeps the generated specifications when the toggle is on', async () => {
    const product = await runDataGeneration({
      productCount: 1,
      generateSpecifications: true,
    });

    expect(product.specifications).toHaveLength(1);
    expect(product.productSpecifications).toHaveLength(1);
  });

  it('drops them when the toggle is off, since nothing registers them', async () => {
    const product = await runDataGeneration({
      productCount: 1,
      generateSpecifications: false,
    });

    expect(product.specifications).toEqual([]);
    expect(product.productSpecifications).toEqual([]);
  });
});

describe('Route parity for the gated steps', () => {
  // routes/mcp.cjs holds a copy of the generate route's step list (#686). A gate
  // added to one copy and not the other is the defect #647 documents, so the
  // gated steps may only reach either list through the shared helpers.
  it.each(['generate.cjs', 'mcp.cjs'])(
    '%s composes the optional product steps through productSubflow',
    (routeFile) => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'routes', routeFile),
        'utf8'
      );

      expect(source).toContain('warehouseCreationSteps(options)');
      expect(source).toContain('specificationSteps(options)');
    }
  );
});
