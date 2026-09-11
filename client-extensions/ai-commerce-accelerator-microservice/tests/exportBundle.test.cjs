const fs = require('fs');
const os = require('os');
const path = require('path');

// Set before anything reads the ENV layer: `utils/constants.cjs` resolves its
// defaults at require time, the same way `tests/mediaArchive.test.cjs` does.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-export-bundle-'));
process.env.MEDIA_ARCHIVE_ENABLED = 'true';
process.env.MEDIA_ARCHIVE_PATH = ROOT;

const exportRoutes = require('../routes/export.cjs');
const {
  KIND,
  mediaFolder,
  readMediaBundle,
} = require('../utils/mediaBundle.cjs');
const { MANIFEST_FILE } = require('../utils/mediaArchive.cjs');

// #896: the archive has had a writer since #848 and nothing that reads it
// back, so the only way to obtain a package was to point at a live instance
// and pull every binary across the network. These cover the cheap route - and
// above all the two ways it must refuse to be cheap and wrong: an empty
// archive must not yield an empty package, and a partial one must say which
// pictures are not in the box.

const SESSION_ID = 'AICA-SESSION-896';

const IMAGE = {
  contentType: 'image/webp',
  kind: KIND.IMAGE,
  priority: 1,
  productERC: 'AICA-PRD-HELMET',
  title: 'helmet.webp',
};

const PDF = {
  contentType: 'application/pdf',
  kind: KIND.PDF,
  priority: 1,
  productERC: 'AICA-PRD-HELMET',
  title: 'helmet.pdf',
};

function session({ images = [IMAGE], pdfs = [PDF] } = {}) {
  return {
    session_id: SESSION_ID,
    session_name: 'Solara Moto',
    updated_at: '2026-09-11T09:00:00.000Z',
    context: {
      productDataList: [{ externalReferenceCode: IMAGE.productERC }],
      createdImages: images,
      createdPdfs: pdfs,
    },
  };
}

/** Lays down an archive directory the way `MediaArchive.record` would have. */
function writeArchive({ files, sessionId = SESSION_ID }) {
  const dir = path.join(ROOT, sessionId);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });

  const recorded = files.map(({ bytes, write = true, ...entry }) => {
    const folder = mediaFolder(entry.kind);
    const extension = entry.kind === KIND.PDF ? 'pdf' : 'webp';
    const file = `${folder}/${entry.productERC}-${entry.priority}.${extension}`;

    if (write) fs.writeFileSync(path.join(dir, file), bytes);

    return { ...entry, file };
  });

  fs.writeFileSync(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ files: recorded, unresolved: [], version: 1 })
  );

  return dir;
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

function handler({ stored = session() } = {}) {
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
    liferayService: {},
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    persistenceService: {
      getLatestCompletedSession: async () => null,
      getSession: async (id) => (stored && id === SESSION_ID ? stored : null),
    },
  });

  return handlers['GET /export-commerce-bundle'];
}

async function call({ query = { sessionId: SESSION_ID }, ...options } = {}) {
  const res = response();
  await handler(options)({ body: {}, headers: {}, query }, res);
  return res;
}

afterEach(() => {
  fs.rmSync(path.join(ROOT, SESSION_ID), { force: true, recursive: true });
});

describe('GET /export-commerce-bundle', () => {
  it('packages the session and the media the run wrote to disk', async () => {
    writeArchive({
      files: [
        { ...IMAGE, bytes: Buffer.from('helmet image') },
        { ...PDF, bytes: Buffer.from('helmet datasheet') },
      ],
    });

    const res = await call();

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-AICA-Media-Images']).toBe('1');
    expect(res.headers['X-AICA-Media-Pdfs']).toBe('1');
    expect(res.headers['X-AICA-Media-Unresolved']).toBe('0');
    expect(res.headers['X-AICA-Media-Source']).toBe('archive');
    expect(res.headers['Content-Disposition']).toContain('.aicap');

    const bundle = await readMediaBundle(res.body);

    expect(bundle.dataset.metadata.sessionId).toBe(SESSION_ID);
    expect(bundle.media.map((item) => item.buffer.toString())).toEqual([
      'helmet image',
      'helmet datasheet',
    ]);
    expect(bundle.missing).toEqual([]);
  });

  it('refuses rather than handing back a catalogue with no pictures', async () => {
    const res = await call();

    expect(res.statusCode).toBe(409);
    expect(res.body.expected).toBe(2);
    expect(res.body.mediaArchive).toBe('unavailable');
    expect(res.body.error).toContain('/extract-commerce-bundle');
  });

  it('names every item the archive cannot supply, and still builds', async () => {
    writeArchive({
      files: [
        { ...IMAGE, bytes: Buffer.from('helmet image') },
        { ...PDF, bytes: Buffer.from('gone'), write: false },
      ],
    });

    const res = await call();

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-AICA-Media-Images']).toBe('1');
    expect(res.headers['X-AICA-Media-Pdfs']).toBe('0');
    expect(res.headers['X-AICA-Media-Unresolved']).toBe('1');

    const { manifest } = await readMediaBundle(res.body);

    expect(manifest.unresolved).toHaveLength(1);
    expect(manifest.unresolved[0].productERC).toBe(PDF.productERC);
    expect(manifest.unresolved[0].reason).toContain('no longer holds');
  });

  it('reports media the run recorded that never reached the archive', async () => {
    writeArchive({ files: [{ ...IMAGE, bytes: Buffer.from('helmet image') }] });

    const res = await call();

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-AICA-Media-Unresolved']).toBe('1');

    const { manifest } = await readMediaBundle(res.body);

    expect(manifest.unresolved[0].kind).toBe(KIND.PDF);
    expect(manifest.unresolved[0].reason).toContain('never received it');
  });

  it('will not read a file the manifest points outside the session directory', async () => {
    const dir = writeArchive({
      files: [{ ...IMAGE, bytes: Buffer.from('helmet image') }],
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')
    );

    manifest.files.push({ ...PDF, file: '../../../etc/hosts' });
    fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest));

    const res = await call();

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-AICA-Media-Pdfs']).toBe('0');

    const bundle = await readMediaBundle(res.body);

    expect(bundle.manifest.unresolved[0].reason).toContain(
      'outside the session directory'
    );
  });

  it('builds an honest empty package for a run that generated no media', async () => {
    const res = await call({
      stored: session({ images: [], pdfs: [] }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-AICA-Media-Images']).toBe('0');
    expect(res.headers['X-AICA-Media-Unresolved']).toBe('0');

    const { dataset } = await readMediaBundle(res.body);

    expect(dataset.products).toHaveLength(1);
  });

  it('will not fall back to whatever ran last', async () => {
    const res = await call({ query: {} });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('sessionId is required');
  });

  it('says so when the session is not there', async () => {
    const res = await call({ query: { sessionId: 'AICA-SESSION-NOPE' } });

    expect(res.statusCode).toBe(404);
  });
});
