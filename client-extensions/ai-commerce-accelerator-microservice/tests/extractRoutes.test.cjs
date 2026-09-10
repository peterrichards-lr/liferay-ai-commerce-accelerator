const exportRoutes = require('../routes/export.cjs');
const {
  HELMET,
  PANNIER,
  PRICE_LISTS,
  WAREHOUSES,
} = require('./fixtures/solaraMotoInstance.cjs');
const { liferayInstanceStub } = require('./fixtures/liferayInstanceStub.cjs');
const { readMediaBundle } = require('../utils/mediaBundle.cjs');
const { OWNERSHIP_SCOPE_CONFIRMATION } = require('../utils/ownershipScope.cjs');

// #849: POST /extract-commerce-bundle could only build a package from a
// session. These cover the choice of where the dataset half comes from - and
// above all that the choice is explicit, because inferring it from a missing
// sessionId would turn a typo into a silently different package.

const CATALOG = { id: 61432, name: 'Solara Moto' };
const CHANNEL = { id: 90001, name: 'Solara Moto Storefront' };

function routes({ liferayService, session }) {
  const handlers = {};

  const app = {
    get: (path, ...fns) => {
      handlers[`GET ${path}`] = fns[fns.length - 1];
    },
    post: (path, ...fns) => {
      handlers[`POST ${path}`] = fns[fns.length - 1];
    },
  };

  exportRoutes(app, {
    cacheService: { get: () => null },
    liferayService,
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    persistenceService: {
      getLatestCompletedSession: async () => null,
      getSession: async () => session || null,
    },
  });

  return handlers['POST /extract-commerce-bundle'];
}

function instance() {
  const stub = liferayInstanceStub({
    priceLists: PRICE_LISTS,
    products: [HELMET, PANNIER],
    warehouses: WAREHOUSES,
  });

  return {
    ...stub,
    getCatalog: async () => CATALOG,
    getCatalogs: async () => [CATALOG],
    getChannels: async () => [CHANNEL],
    getProductAttachmentContent: async () => ({
      buffer: Buffer.from('pdf bytes'),
      contentType: 'application/pdf',
    }),
    getProductImageContent: async () => ({
      buffer: Buffer.from('image bytes'),
      contentType: 'image/webp',
    }),
    client: { headlessCommerceAdminChannel: { v1_0: {} } },
  };
}

function response() {
  const headers = {};
  const res = {
    body: null,
    headers,
    setHeader: (name, value) => {
      headers[name] = value;
    },
    statusCode: 200,
  };

  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.send = (body) => {
    res.body = body;
    return res;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  return res;
}

const request = (body) => ({
  body: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    liferayUrl: 'https://uat.example.invalid',
    ...body,
  },
  correlationId: 'test-correlation-id',
  headers: {},
});

describe('POST /extract-commerce-bundle', () => {
  it('builds a package from the instance when the source says so', async () => {
    const handler = routes({ liferayService: instance() });
    const res = response();

    await handler(request({ source: 'instance' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/zip');

    const bundle = await readMediaBundle(res.body);

    expect(bundle.dataset.metadata.source).toBe('liferay-instance');
    expect(bundle.dataset.products.map((p) => p.externalReferenceCode)).toEqual(
      ['AICA-PRD-HELMET', 'AICA-PRD-PANNIER']
    );
    // The binaries are pulled by mediaExtractor from the same instance, so an
    // instance-sourced package is a whole package rather than a dataset with
    // no pictures.
    expect(bundle.manifest.counts.images).toBe(2);
    expect(bundle.manifest.counts.pdfs).toBe(1);
  });

  it('still requires a sessionId for a session-sourced package', async () => {
    const handler = routes({ liferayService: instance() });
    const res = response();

    await handler(request({}), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/sessionId is required/);
  });

  it('refuses an unknown source rather than guessing at one', async () => {
    // The failure this prevents: a typo'd or renamed source silently falling
    // through to whichever branch happens to be the default.
    const handler = routes({ liferayService: instance() });
    const res = response();

    await handler(request({ source: 'workflows.db' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Unknown source/);
  });

  it('scopes to AICA-owned data unless the confirmation phrase is typed out', async () => {
    const handler = routes({ liferayService: instance() });
    const res = response();

    await handler(
      request({ source: 'instance', ownershipScopeConfirmation: 'yes' }),
      res
    );

    const bundle = await readMediaBundle(res.body);

    expect(bundle.dataset.metadata.ownershipScope).toBe('aica-owned');
    expect(
      bundle.dataset.warehouses.map((w) => w.externalReferenceCode)
    ).toEqual(['AICA-WH-LONDON']);
  });

  it('takes in a catalogue AICA did not create when the phrase is exact', async () => {
    const handler = routes({ liferayService: instance() });
    const res = response();

    await handler(
      request({
        ownershipScopeConfirmation: OWNERSHIP_SCOPE_CONFIRMATION,
        source: 'instance',
      }),
      res
    );

    const bundle = await readMediaBundle(res.body);

    expect(bundle.dataset.metadata.ownershipScope).toBe('everything');
    expect(
      bundle.dataset.warehouses.map((w) => w.externalReferenceCode)
    ).toEqual(['AICA-WH-LONDON', 'CUSTOMER-WH-ROTTERDAM']);
  });

  it('says in a header how many products the instance could not fully answer', async () => {
    const liferayService = instance();
    // A product whose description Liferay does not hold. The package must not
    // pass that off as a complete extract.
    //
    // The list is served from the search index and never carries a
    // description, so the extract hydrates each product from the single-product
    // read (SDK #210). That read is therefore where an absent description has
    // to come from now - forcing it on the list alone proves nothing, because
    // the detail read would fill it back in.
    liferayService.getProductsWithSkus = async () => ({
      items: [{ ...HELMET.product, skus: HELMET.skus }],
      totalCount: 1,
    });
    liferayService.rest = {
      async getProductById() {
        return { ...HELMET.product, description: undefined };
      },
    };

    const handler = routes({ liferayService });
    const res = response();

    await handler(request({ source: 'instance' }), res);

    expect(res.headers['X-AICA-Products-Incomplete']).toBe('1');

    const bundle = await readMediaBundle(res.body);
    const [report] = bundle.dataset.metadata.translationReport;

    expect(report.externalReferenceCode).toBe('AICA-PRD-HELMET');
    expect(report.missing).toContainEqual({
      key: 'description',
      required: true,
    });
  });

  it('reports a truncated read as a failure rather than shipping a short package', async () => {
    const liferayService = instance();

    liferayService.getProductsWithSkus = async () => {
      throw new Error('Failed to fetch SKUs for products: 503');
    };

    const handler = routes({ liferayService });
    const res = response();

    await handler(request({ source: 'instance' }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.errorReference).toBeTruthy();
  });
});
