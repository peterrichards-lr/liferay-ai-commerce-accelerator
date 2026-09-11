const fs = require('fs');
const os = require('os');
const path = require('path');

// Both set before the ENV layer resolves, which is why this case has a file of
// its own: `utils/constants.cjs` reads process.env once, at require time, and
// `vi.resetModules()` does not make it read again.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-staging-retention-'));
process.env.MEDIA_ARCHIVE_PATH = ROOT;
process.env.MEDIA_ARCHIVE_RETAIN = 'false';

const exportRoutes = require('../routes/export.cjs');
const {
  HELMET,
  PRICE_LISTS,
  WAREHOUSES,
} = require('./fixtures/solaraMotoInstance.cjs');
const { liferayInstanceStub } = require('./fixtures/liferayInstanceStub.cjs');
const { EXTRACT_STAGING_PREFIX } = require('../utils/mediaArchive.cjs');

// Retention off means a directory staged purely to build a package goes as
// soon as the package has been sent. A session's own directory is not staging
// and is left alone - that distinction is the whole of the setting (#898).

const SESSION_ID = 'AICA-SESSION-RETAIN-OFF';

const session = {
  session_id: SESSION_ID,
  session_name: 'Solara Moto',
  updated_at: '2026-09-11T09:00:00.000Z',
  context: {
    productDataList: [{ externalReferenceCode: 'AICA-PRD-HELMET' }],
    createdImages: [],
    createdPdfs: [],
  },
};

function instance() {
  return {
    ...liferayInstanceStub({
      priceLists: PRICE_LISTS,
      products: [HELMET],
      warehouses: WAREHOUSES,
    }),
    getCatalog: async () => ({ id: 61432, name: 'Solara Moto' }),
    getCatalogs: async () => [{ id: 61432, name: 'Solara Moto' }],
    getChannels: async () => [{ id: 90001, name: 'Storefront' }],
    getProductImages: async () => [
      { contentType: 'image/webp', priority: 1, src: '/o/media/1' },
    ],
    getProductAttachments: async () => [],
    getProductImageContent: async () => ({
      buffer: Buffer.from('bytes'),
      contentType: 'image/webp',
    }),
    getProductAttachmentContent: async () => ({ buffer: Buffer.from('pdf') }),
    client: { headlessCommerceAdminChannel: { v1_0: {} } },
  };
}

function response() {
  const headers = {};
  const res = { body: null, headers, statusCode: 200 };

  res.setHeader = (name, value) => {
    headers[name] = value;
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

function handlerFor() {
  const handlers = {};
  const app = {
    get: (route, ...fns) => {
      handlers[`GET ${route}`] = fns[fns.length - 1];
    },
    post: (route, ...fns) => {
      handlers[`POST ${route}`] = fns[fns.length - 1];
    },
  };

  exportRoutes(app, {
    cacheService: { get: () => null },
    liferayService: instance(),
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    persistenceService: {
      getLatestCompletedSession: async () => null,
      getSession: async () => session,
    },
  });

  return handlers['POST /extract-commerce-bundle'];
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

describe('With retention off', () => {
  it('drops a staging directory once its package is sent', async () => {
    const res = response();

    await handlerFor()(request({ source: 'instance' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(
      fs.readdirSync(ROOT).filter((n) => n.startsWith(EXTRACT_STAGING_PREFIX))
    ).toEqual([]);
  });

  it("keeps a session's own directory, which is not staging", async () => {
    await handlerFor()(request({ sessionId: SESSION_ID }), response());

    expect(fs.existsSync(path.join(ROOT, SESSION_ID))).toBe(true);
  });
});
