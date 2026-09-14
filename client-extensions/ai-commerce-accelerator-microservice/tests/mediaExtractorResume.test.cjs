const fs = require('fs');
const os = require('os');
const path = require('path');

// Set before anything reads the ENV layer: `utils/constants.cjs` resolves its
// defaults at require time, the same way `tests/mediaArchive.test.cjs` does.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-media-resume-'));
process.env.MEDIA_ARCHIVE_PATH = ROOT;

const { extractDatasetMedia } = require('../utils/mediaExtractor.cjs');
const {
  openMediaArchive,
  readMediaArchive,
  resetMediaArchives,
} = require('../utils/mediaArchive.cjs');

// #895: a failed extract used to restart from nothing - every product
// re-listed, every attachment re-downloaded, even the ones that had already
// landed on disk. These cover the fix: a retry against the same session reads
// what its own manifest already has resolved and fetches only the rest.
//
// `resetMediaArchives()` runs between "runs" in every test so each call to
// `openMediaArchive` constructs a fresh `MediaArchive` that loads its state
// from disk, the way a genuinely separate retry (a new HTTP request, possibly
// after a service restart) would - not from the in-process cache a same-run
// second call would hit.

const SESSION_ID = 'AICA-SESSION-895-EXTRACT';

const PRODUCT = { externalReferenceCode: 'AICA-PRD-HELMET' };

function openArchive() {
  resetMediaArchives();
  return openMediaArchive({ sessionId: SESSION_ID });
}

describe('Resuming a failed extract (#895)', () => {
  afterEach(() => {
    resetMediaArchives();
    fs.rmSync(path.join(ROOT, SESSION_ID), { force: true, recursive: true });
  });

  it('does not refetch an item its own manifest already resolved', async () => {
    const contentCalls = [];
    const firstRun = {
      getProductAttachments: async () => [],
      getProductImageContent: async (_config, locator) => {
        contentCalls.push(locator);
        return {
          buffer: Buffer.from('helmet-bytes'),
          contentType: 'image/webp',
        };
      },
      getProductImages: async () => [
        {
          contentType: 'image/webp',
          priority: 1,
          src: '/o/media/1',
          title: 'front',
        },
      ],
    };

    const first = await extractDatasetMedia({
      archive: openArchive(),
      config: {},
      liferayService: firstRun,
      logger: { info: () => {}, warn: () => {} },
      products: [PRODUCT],
    });

    expect(first).toEqual({ reused: 0, staged: 1, unresolved: 0 });
    expect(contentCalls).toEqual(['/o/media/1']);

    // Second run: listing still answers with the same attachment, but the
    // content read would blow up if it were ever called.
    const secondRun = {
      ...firstRun,
      getProductImageContent: async () => {
        throw new Error('content fetch should not have been called again');
      },
    };

    const second = await extractDatasetMedia({
      archive: openArchive(),
      config: {},
      liferayService: secondRun,
      logger: { info: () => {}, warn: () => {} },
      products: [PRODUCT],
    });

    expect(second).toEqual({ reused: 1, staged: 0, unresolved: 0 });
    // Only the first run's call ever reached the content endpoint.
    expect(contentCalls).toEqual(['/o/media/1']);

    const archived = readMediaArchive({ sessionId: SESSION_ID });
    expect(archived.entries).toHaveLength(1);
    expect(archived.missing).toEqual([]);
  });

  it('survives a transient failure on retry instead of deleting the good file', async () => {
    // This is the regression #895 warns about: `archive.record` calls
    // `forget` before writing, so re-running the fetch for an item that had
    // already resolved - and having that retry fail - used to delete the
    // file a previous run had already secured. Skipping already-resolved
    // items means that fetch is never attempted, so it can never fail.
    const firstRun = {
      getProductAttachments: async () => [],
      getProductImageContent: async () => ({
        buffer: Buffer.from('helmet-bytes'),
        contentType: 'image/webp',
      }),
      getProductImages: async () => [
        {
          contentType: 'image/webp',
          priority: 1,
          src: '/o/media/1',
          title: 'front',
        },
      ],
    };

    await extractDatasetMedia({
      archive: openArchive(),
      config: {},
      liferayService: firstRun,
      logger: { info: () => {}, warn: () => {} },
      products: [PRODUCT],
    });

    const flakyRun = {
      ...firstRun,
      getProductImageContent: async () => {
        throw new Error('502 from the media servlet');
      },
    };

    await extractDatasetMedia({
      archive: openArchive(),
      config: {},
      liferayService: flakyRun,
      logger: { info: () => {}, warn: () => {} },
      products: [PRODUCT],
    });

    const archived = readMediaArchive({ sessionId: SESSION_ID });
    expect(archived.entries).toHaveLength(1);
    expect(archived.manifest.unresolved).toEqual([]);
  });

  it('still fetches an item that did not resolve last time', async () => {
    const listCalls = [];
    let attempt = 0;
    const liferayService = {
      getProductAttachments: async () => [],
      getProductImageContent: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('timed out');
        return {
          buffer: Buffer.from('helmet-bytes'),
          contentType: 'image/webp',
        };
      },
      getProductImages: async (_config, erc) => {
        listCalls.push(erc);
        return [
          {
            contentType: 'image/webp',
            priority: 1,
            src: '/o/media/1',
            title: 'front',
          },
        ];
      },
    };

    const first = await extractDatasetMedia({
      archive: openArchive(),
      config: {},
      liferayService,
      logger: { info: () => {}, warn: () => {} },
      products: [PRODUCT],
    });

    expect(first).toEqual({ reused: 0, staged: 0, unresolved: 1 });

    const second = await extractDatasetMedia({
      archive: openArchive(),
      config: {},
      liferayService,
      logger: { info: () => {}, warn: () => {} },
      products: [PRODUCT],
    });

    // Retried, not skipped, and this time it resolves.
    expect(second).toEqual({ reused: 0, staged: 1, unresolved: 0 });
    expect(listCalls).toEqual(['AICA-PRD-HELMET', 'AICA-PRD-HELMET']);

    const archived = readMediaArchive({ sessionId: SESSION_ID });
    expect(archived.entries).toHaveLength(1);
    expect(archived.manifest.unresolved).toEqual([]);
  });

  it('leaves a fresh, never-extracted session behaving exactly as before', async () => {
    const liferayService = {
      getProductAttachments: async () => [],
      getProductImageContent: async () => ({
        buffer: Buffer.from('helmet-bytes'),
        contentType: 'image/webp',
      }),
      getProductImages: async () => [
        { contentType: 'image/webp', priority: 1, src: '/o/media/1' },
      ],
    };

    const result = await extractDatasetMedia({
      archive: openArchive(),
      config: {},
      liferayService,
      logger: { info: () => {}, warn: () => {} },
      products: [PRODUCT],
    });

    expect(result).toEqual({ reused: 0, staged: 1, unresolved: 0 });
  });
});
