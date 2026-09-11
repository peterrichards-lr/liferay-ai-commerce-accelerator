const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-extract-staging-'));
process.env.MEDIA_ARCHIVE_PATH = ROOT;

const exportRoutes = require('../routes/export.cjs');
const {
  HELMET,
  PRICE_LISTS,
  WAREHOUSES,
} = require('./fixtures/solaraMotoInstance.cjs');
const { liferayInstanceStub } = require('./fixtures/liferayInstanceStub.cjs');
const { readMediaBundle } = require('../utils/mediaBundle.cjs');
const {
  EXTRACT_STAGING_PREFIX,
  resetMediaArchives,
} = require('../utils/mediaArchive.cjs');

// #898: extract used to hold every binary in memory, hand them to the zip and
// leave nothing behind, so the expensive operation was also the one that had
// to be repeated. These cover what staging buys - an extract that repairs the
// session's own archive, and a staging directory that does not outlive its
// package when retention is off.

const SESSION_ID = 'AICA-SESSION-STAGED';

const session = {
  session_id: SESSION_ID,
  session_name: 'Solara Moto',
  updated_at: '2026-09-11T09:00:00.000Z',
  context: {
    productDataList: [{ externalReferenceCode: 'AICA-PRD-HELMET' }],
    createdImages: [
      {
        contentType: 'image/webp',
        priority: 1,
        productERC: 'AICA-PRD-HELMET',
        title: 'helmet.webp',
      },
    ],
    createdPdfs: [],
  },
};

function instance() {
  let imageReads = 0;

  const stub = liferayInstanceStub({
    priceLists: PRICE_LISTS,
    products: [HELMET],
    warehouses: WAREHOUSES,
  });

  return {
    ...stub,
    get imageReads() {
      return imageReads;
    },
    getCatalog: async () => ({ id: 61432, name: 'Solara Moto' }),
    getCatalogs: async () => [{ id: 61432, name: 'Solara Moto' }],
    getChannels: async () => [{ id: 90001, name: 'Storefront' }],
    getProductImages: async () => [
      {
        contentType: 'image/webp',
        priority: 1,
        src: '/o/commerce-media/images/1',
        title: 'helmet.webp',
      },
    ],
    getProductAttachments: async () => [],
    getProductImageContent: async () => {
      imageReads += 1;
      return {
        buffer: Buffer.from('helmet bytes'),
        contentType: 'image/webp',
      };
    },
    getProductAttachmentContent: async () => ({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
    }),
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

function routes(liferayService) {
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
    liferayService,
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    persistenceService: {
      getLatestCompletedSession: async () => null,
      getSession: async (id) => (id === SESSION_ID ? session : null),
    },
  });

  return handlers;
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

afterEach(() => {
  resetMediaArchives();
  for (const entry of fs.readdirSync(ROOT)) {
    fs.rmSync(path.join(ROOT, entry), { force: true, recursive: true });
  }
});

describe('An extract against a session', () => {
  it('leaves the session able to export without touching Liferay again', async () => {
    const liferayService = instance();
    const handlers = routes(liferayService);

    const extracted = response();
    await handlers['POST /extract-commerce-bundle'](
      request({ sessionId: SESSION_ID }),
      extracted
    );

    expect(extracted.statusCode).toBe(200);
    expect(liferayService.imageReads).toBe(1);

    // The archive the run never wrote is now written, so the cheap route can
    // build the same package - which is the whole point of staging rather
    // than accumulating buffers and dropping them.
    const exported = response();
    await handlers['GET /export-commerce-bundle'](
      { body: {}, headers: {}, query: { sessionId: SESSION_ID } },
      exported
    );

    expect(exported.statusCode).toBe(200);
    expect(exported.headers['X-AICA-Media-Source']).toBe('archive');
    expect(liferayService.imageReads).toBe(1);

    const bundle = await readMediaBundle(exported.body);

    expect(bundle.media).toHaveLength(1);
    expect(bundle.media[0].buffer.toString()).toBe('helmet bytes');
  });

  it('does not accumulate a second copy when it is run again', async () => {
    const handlers = routes(instance());

    for (const _run of [1, 2]) {
      await handlers['POST /extract-commerce-bundle'](
        request({ sessionId: SESSION_ID }),
        response()
      );
    }

    const exported = response();
    await handlers['GET /export-commerce-bundle'](
      { body: {}, headers: {}, query: { sessionId: SESSION_ID } },
      exported
    );

    const bundle = await readMediaBundle(exported.body);

    expect(bundle.manifest.counts.images).toBe(1);
    expect(bundle.manifest.counts.unresolved).toBe(0);
  });

  it('keeps the session directory, which belongs to the session', async () => {
    const handlers = routes(instance());

    await handlers['POST /extract-commerce-bundle'](
      request({ sessionId: SESSION_ID }),
      response()
    );

    expect(fs.existsSync(path.join(ROOT, SESSION_ID))).toBe(true);
  });
});

describe('An extract against an instance', () => {
  it('stages under a minted id, since there is no session behind it', async () => {
    const handlers = routes(instance());
    const res = response();

    await handlers['POST /extract-commerce-bundle'](
      request({ source: 'instance' }),
      res
    );

    expect(res.statusCode).toBe(200);

    const staged = fs
      .readdirSync(ROOT)
      .filter((name) => name.startsWith(EXTRACT_STAGING_PREFIX));

    expect(staged).toHaveLength(1);
  });
});
