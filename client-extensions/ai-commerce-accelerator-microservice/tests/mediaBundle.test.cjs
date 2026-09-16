const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const {
  DATASET_ENTRY,
  PACKAGE_EXTENSION,
  MANIFEST_ENTRY,
  buildMediaBundle,
  looksLikeZip,
  readMediaBundle,
} = require('../utils/mediaBundle.cjs');
const { extractDatasetMedia, srcPath } = require('../utils/mediaExtractor.cjs');
const { streamToBuffer } = require('./fixtures/streamToBuffer.cjs');

// #814: a promotion must land the same pictures, not equivalent ones. The
// round trip is the assertion that matters - everything else can pass while
// promoted products still end up with nothing attached.

const DATASET = {
  metadata: { source: 'session-db', sessionId: 'AICA-SESSION-1' },
  products: [
    { externalReferenceCode: 'AICA-PRD-1', name: { en_US: 'Alpine Helmet' } },
    { externalReferenceCode: 'AICA-PRD-2', name: { en_US: 'Pannier Liner' } },
  ],
};

const image = (productERC, bytes) => ({
  buffer: Buffer.from(bytes),
  contentType: 'image/webp',
  kind: 'image',
  priority: 1,
  productERC,
  title: { en_US: `${productERC} image` },
});

/**
 * `buildMediaBundle` hands back a stream rather than a `Buffer` (#877), so
 * that a real caller (routes/export.cjs) never has to hold the whole archive
 * in memory just to send it. Most of what follows only cares about the bytes
 * once they exist, so this collects them the way `routes/export.cjs` used to
 * do it for the caller - a test convenience, not something production code
 * does any more.
 */
async function packMediaBundle(args) {
  const { manifest, stream } = await buildMediaBundle(args);
  return { buffer: await streamToBuffer(stream), manifest };
}

describe('Media bundle round trip', () => {
  it('carries the dataset and every binary back out unchanged', async () => {
    const { buffer } = await packMediaBundle({
      dataset: DATASET,
      media: [
        image('AICA-PRD-1', 'first-image-bytes'),
        image('AICA-PRD-2', 'second-image-bytes'),
        {
          buffer: Buffer.from('pdf-bytes'),
          contentType: 'application/pdf',
          kind: 'pdf',
          priority: 1,
          productERC: 'AICA-PRD-1',
          title: { en_US: 'manual.pdf' },
        },
      ],
    });

    const read = await readMediaBundle(buffer);

    expect(read.dataset).toEqual(DATASET);
    expect(read.media).toHaveLength(3);
    expect(read.missing).toHaveLength(0);

    // The bytes, not merely the count. A bundle that carries the right number
    // of wrong files would satisfy a count assertion.
    const first = read.media.find(
      (m) => m.productERC === 'AICA-PRD-1' && m.kind === 'image'
    );
    expect(first.buffer.toString()).toBe('first-image-bytes');
    expect(first.contentType).toBe('image/webp');
    expect(first.title).toEqual({ en_US: 'AICA-PRD-1 image' });

    const pdf = read.media.find((m) => m.kind === 'pdf');
    expect(pdf.buffer.toString()).toBe('pdf-bytes');
  });

  it('carries a binary supplied by path exactly as it carries one supplied by buffer', async () => {
    // The real producer of `path` entries is `readMediaArchive`, staging a
    // session's own directory - this stands in for that with a plain temp
    // file, because what is under test is `buildMediaBundle`'s own handling
    // of the two shapes, not the archive that usually supplies one of them.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-mediabundle-'));
    const file = path.join(dir, 'from-disk.webp');
    fs.writeFileSync(file, 'bytes read off disk');

    try {
      const { buffer } = await packMediaBundle({
        dataset: DATASET,
        media: [
          {
            contentType: 'image/webp',
            kind: 'image',
            path: file,
            priority: 1,
            productERC: 'AICA-PRD-1',
            title: { en_US: 'from disk' },
          },
        ],
      });

      const read = await readMediaBundle(buffer);

      expect(read.media).toHaveLength(1);
      expect(read.media[0].buffer.toString()).toBe('bytes read off disk');
    } finally {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it('records what it could not resolve instead of dropping it', async () => {
    const { manifest } = await packMediaBundle({
      dataset: DATASET,
      media: [
        image('AICA-PRD-1', 'ok'),
        {
          kind: 'image',
          productERC: 'AICA-PRD-2',
          reason: 'content fetch failed: 403',
        },
      ],
    });

    // An export quietly carrying fewer pictures than the source is the exact
    // failure this feature exists to prevent, so it is in the artefact rather
    // than only in a log the importer never sees.
    expect(manifest.counts).toMatchObject({ images: 1, unresolved: 1 });
    expect(manifest.unresolved[0]).toMatchObject({
      productERC: 'AICA-PRD-2',
      reason: 'content fetch failed: 403',
    });
  });

  it('records a path that no longer resolves to a file the same way as no content at all', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-mediabundle-'));
    const gone = path.join(dir, 'never-written.webp');
    fs.rmSync(dir, { force: true, recursive: true });

    const { manifest } = await packMediaBundle({
      dataset: DATASET,
      media: [{ ...image('AICA-PRD-1', 'x'), buffer: undefined, path: gone }],
    });

    expect(manifest.counts).toMatchObject({ images: 0, unresolved: 1 });
    expect(manifest.unresolved[0].reason).toContain('no longer on disk');
  });

  it('reports a manifest entry whose file is absent from the archive', async () => {
    const { buffer } = await packMediaBundle({
      dataset: DATASET,
      media: [image('AICA-PRD-1', 'ok')],
    });

    const zip = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(await zip.file(MANIFEST_ENTRY).async('string'));
    zip.remove(manifest.files[0].file);
    const tampered = await zip.generateAsync({ type: 'nodebuffer' });

    const read = await readMediaBundle(tampered);

    expect(read.media).toHaveLength(0);
    expect(read.missing).toHaveLength(1);
  });

  it('gives distinct entry names to two products with awkward codes', async () => {
    const { manifest } = await packMediaBundle({
      dataset: DATASET,
      media: [
        image('AICA/PRD 1', 'a'),
        image('AICA/PRD 1', 'b'),
        image('AICA PRD/1', 'c'),
      ],
    });

    // Model-generated codes carry spaces and slashes. A collision would
    // silently overwrite one product's picture with another's.
    const names = manifest.files.map((file) => file.file);
    expect(new Set(names).size).toBe(3);
    expect(names.every((name) => !name.includes(' '))).toBe(true);
  });

  it('refuses an archive that is not a dataset bundle', async () => {
    const zip = new JSZip();
    zip.file('something-else.txt', 'not a dataset');

    await expect(
      readMediaBundle(await zip.generateAsync({ type: 'nodebuffer' }))
    ).rejects.toThrow(DATASET_ENTRY);
  });

  it('recognises a zip by its header, not its name', async () => {
    const { buffer } = await packMediaBundle({ dataset: DATASET, media: [] });

    expect(looksLikeZip(buffer)).toBe(true);
    expect(looksLikeZip(Buffer.from(JSON.stringify(DATASET)))).toBe(false);
    expect(looksLikeZip(undefined)).toBe(false);
  });
});

// #877: building used to collect every binary as a Buffer and hand the whole
// set to JSZip before generating one more Buffer for the archive, so the
// payload existed twice at the moment it was produced. Reading did the
// mirror image: the whole upload parsed into one more in-memory copy before
// any entry was touched. These assert the mechanism that replaced both -
// nothing here measures process memory directly, which vitest workers make
// unreliable, so what is checked is *how* the bytes reach the archive and
// come back out of it.
describe('Streaming rather than buffering the whole package (#877)', () => {
  function stagedFiles(count, sizeBytes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-mediabundle-'));
    const files = [];

    for (let i = 0; i < count; i += 1) {
      const file = path.join(dir, `staged-${i}.pdf`);
      // A distinct fill byte per file, so a mix-up between entries would show
      // up as wrong content rather than merely a wrong count.
      fs.writeFileSync(file, Buffer.alloc(sizeBytes, 65 + i));
      files.push(file);
    }

    return { dir, files };
  }

  it('reads staged binaries as streams, never as a whole Buffer, on the way into the archive', async () => {
    const { dir, files } = stagedFiles(3, 2 * 1024 * 1024);

    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
    const createReadStreamSpy = vi.spyOn(fs, 'createReadStream');

    try {
      const media = files.map((file, index) => ({
        contentType: 'application/pdf',
        kind: 'pdf',
        path: file,
        priority: 1,
        productERC: `AICA-PRD-${index}`,
        title: null,
      }));

      const { manifest, stream } = await buildMediaBundle({
        dataset: DATASET,
        media,
      });

      // A `generateAsync({type:'nodebuffer'})` implementation would need to
      // have read every one of those 6MB by the time this line runs, because
      // it cannot produce a `Buffer` without them. This runs immediately
      // after, and the assertions below still find none of the files
      // consumed with `readFileSync`.
      for (const file of files) {
        expect(createReadStreamSpy).toHaveBeenCalledWith(file);
        expect(readFileSyncSpy).not.toHaveBeenCalledWith(file);
      }

      // Draining the stream is what actually reads the bytes - proof the
      // entries are real, not merely proof nothing was read yet.
      const buffer = await streamToBuffer(stream);
      const read = await readMediaBundle(buffer);

      expect(manifest.counts.pdfs).toBe(3);
      expect(read.media).toHaveLength(3);
      expect(
        read.media
          .sort((a, b) => a.productERC.localeCompare(b.productERC))
          .map((item) => item.buffer[0])
      ).toEqual([65, 66, 67]);
    } finally {
      readFileSyncSpy.mockRestore();
      createReadStreamSpy.mockRestore();
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it('reads the uploaded archive from a temporary file rather than parsing a Buffer in memory', async () => {
    const { buffer } = await packMediaBundle({
      dataset: DATASET,
      media: [image('AICA-PRD-1', 'bytes for the round trip')],
    });

    const loadAsyncSpy = vi.spyOn(JSZip.prototype, 'loadAsync');
    const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync');

    try {
      const read = await readMediaBundle(buffer);

      // JSZip.loadAsync is how the old implementation held the archive a
      // second time as its own parsed copy; this never calls it at all.
      expect(loadAsyncSpy).not.toHaveBeenCalled();
      // The upload went to disk before anything tried to read an entry out
      // of it.
      expect(writeFileSyncSpy).toHaveBeenCalled();
      expect(read.dataset).toEqual(DATASET);
    } finally {
      loadAsyncSpy.mockRestore();
      writeFileSyncSpy.mockRestore();
    }
  });

  it('cleans up its temporary file whether or not the upload turns out to be a bundle', async () => {
    const before = fs
      .readdirSync(os.tmpdir())
      .filter((name) => name.startsWith('aica-import-bundle-'));

    await expect(
      readMediaBundle(Buffer.from('not a zip at all'))
    ).rejects.toThrow();

    const after = fs
      .readdirSync(os.tmpdir())
      .filter((name) => name.startsWith('aica-import-bundle-'));

    expect(after).toEqual(before);
  });
});

/**
 * What the extractor writes into, without a disk.
 *
 * The extractor no longer returns binaries - it stages each one as it arrives
 * and releases it (#898) - so what it did is read back off the archive it was
 * given rather than off a return value.
 */
function collectingArchive() {
  const staged = [];

  return {
    enabled: true,
    staged,
    link() {},
    record(item) {
      staged.push(item);

      return item.buffer && item.buffer.length > 0
        ? { ...item, file: `media/${staged.length}` }
        : null;
    },
  };
}

describe('Extracting media from the source instance', () => {
  const liferayService = {
    getProductImages: async (_config, erc) =>
      erc === 'AICA-PRD-1'
        ? [
            {
              contentType: 'image/webp',
              priority: 1,
              src: '/o/media/1',
              title: { en_US: 'one' },
            },
          ]
        : [],
    getProductAttachments: async () => [],
    getProductImageContent: async () => ({
      buffer: Buffer.from('resolved-bytes'),
      contentType: 'image/webp',
    }),
    getProductAttachmentContent: async () => ({ buffer: Buffer.from('pdf') }),
  };

  const logger = { warn: () => {}, info: () => {} };

  it('resolves each product by its external reference code', async () => {
    const archive = collectingArchive();

    const counts = await extractDatasetMedia({
      archive,
      config: {},
      liferayService,
      logger,
      products: DATASET.products,
    });

    expect(counts).toEqual({ reused: 0, staged: 1, unresolved: 0 });
    expect(archive.staged).toHaveLength(1);
    expect(archive.staged[0]).toMatchObject({
      kind: 'image',
      productERC: 'AICA-PRD-1',
    });
    expect(archive.staged[0].buffer.toString()).toBe('resolved-bytes');
  });

  it('costs one product its pictures when a lookup fails, not the promotion', async () => {
    const failing = {
      ...liferayService,
      getProductImages: async (_config, erc) => {
        if (erc === 'AICA-PRD-1') throw new Error('403 from the media servlet');
        return [{ contentType: 'image/webp', priority: 1, src: '/o/media/2' }];
      },
    };

    const archive = collectingArchive();

    await extractDatasetMedia({
      archive,
      config: {},
      liferayService: failing,
      logger,
      products: DATASET.products,
    });

    // The second product still resolves. Throwing would abandon a promotion
    // partway and leave the target an arbitrary prefix of the catalogue.
    const failed = archive.staged.find((m) => m.productERC === 'AICA-PRD-1');
    const ok = archive.staged.find((m) => m.productERC === 'AICA-PRD-2');

    expect(failed.reason).toContain('403');
    expect(failed.buffer).toBeUndefined();
    expect(ok.buffer.toString()).toBe('resolved-bytes');
  });

  it('falls back to the ERC when an attachment carries no src', async () => {
    const calls = [];
    const byErc = {
      ...liferayService,
      getProductImages: async () => [
        {
          contentType: 'image/png',
          externalReferenceCode: 'AICAIMG-9',
          priority: 2,
        },
      ],
      getProductImageContent: async (_config, locator) => {
        calls.push(locator);
        return { buffer: Buffer.from('x'), contentType: 'image/png' };
      },
    };

    await extractDatasetMedia({
      archive: collectingArchive(),
      config: {},
      liferayService: byErc,
      logger,
      products: [DATASET.products[0]],
    });

    // The catalog API exposes no GET for a numeric attachment id, so the ERC
    // is the only usable fallback (SDK #181).
    expect(calls).toEqual(['AICAIMG-9']);
  });
});

describe('The src Liferay returns', () => {
  // Real payload from lctsolara-uat, 2026-09-10. The public host serves https
  // on 443; :8080 is the internal listener, so this URL connects to nothing.
  const OBSERVED =
    'https://webserver-lctsolara-uat.lfr.cloud:8080/o/commerce-media/accounts/-9223372036854775808/images/90623?download=true';

  it('keeps the path and discards the origin Liferay invented', () => {
    expect(srcPath(OBSERVED)).toBe(
      '/o/commerce-media/accounts/-9223372036854775808/images/90623?download=true'
    );
  });

  it('keeps the query string, since the media servlet reads it', () => {
    expect(srcPath(OBSERVED)).toContain('?download=true');
  });

  it('passes a relative src through unchanged', () => {
    expect(srcPath('/o/commerce-media/images/1')).toBe(
      '/o/commerce-media/images/1'
    );
  });

  it('fetches the path, not the absolute URL', async () => {
    const asked = [];
    const liferayService = {
      getProductImages: async () => [
        { contentType: 'image/webp', priority: 1, src: OBSERVED },
      ],
      getProductAttachments: async () => [],
      getProductImageContent: async (_config, locator) => {
        asked.push(locator);
        return { buffer: Buffer.from('bytes'), contentType: 'image/webp' };
      },
      getProductAttachmentContent: async () => ({ buffer: Buffer.from('') }),
    };

    await extractDatasetMedia({
      archive: collectingArchive(),
      config: {},
      liferayService,
      logger: { warn: () => {}, info: () => {} },
      products: [{ externalReferenceCode: 'AICA-PRD-1' }],
    });

    // Passing the absolute URL through would send the request to :8080 on a
    // host that serves 443, and the promotion would fail at first contact.
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain('8080');
    expect(asked[0].startsWith('/o/commerce-media/')).toBe(true);
  });
});

describe('The package extension (#878)', () => {
  it('is aicap, so the artefact is not mistaken for a folder of files', () => {
    expect(PACKAGE_EXTENSION).toBe('aicap');
  });

  it('is not what decides whether a file is a package', async () => {
    // Someone will rename a package to .zip to look inside it, and a package
    // that then refused to import would be a trap. Detection reads the local
    // file header, so the name is decoration - this exists so nobody
    // "helpfully" adds an extension check later.
    const { buffer } = await packMediaBundle({ dataset: DATASET, media: [] });

    expect(looksLikeZip(buffer)).toBe(true);

    const read = await readMediaBundle(buffer);
    expect(read.dataset).toEqual(DATASET);
  });
});
