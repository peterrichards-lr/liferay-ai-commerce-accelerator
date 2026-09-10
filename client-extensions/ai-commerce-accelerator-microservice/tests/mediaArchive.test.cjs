const fs = require('fs');
const os = require('os');
const path = require('path');

// Set before anything reads the ENV layer: `utils/constants.cjs` resolves its
// defaults at require time, the same way `tests/setup.mjs` redirects
// PERSISTENCE_DB_PATH before the persistence layer loads.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-media-archive-'));
process.env.MEDIA_ARCHIVE_ENABLED = 'true';
process.env.MEDIA_ARCHIVE_PATH = ROOT;

const MediaGenerator = require('../generators/mediaGenerator.cjs');
const {
  BUNDLE_VERSION,
  KIND,
  buildMediaBundle,
  readMediaBundle,
} = require('../utils/mediaBundle.cjs');
const {
  EXTENSIONS,
  MANIFEST_FILE,
  openMediaArchive,
  pruneArchiveRoot,
} = require('../utils/mediaArchive.cjs');

// Generated media used to exist for exactly as long as the upload call, so a
// rejected upload cost a picture that had already been paid for and an export
// had to go back to Liferay for bytes this service had held moments earlier
// (#848). These cover the ordering that fixes it - written before the upload -
// and the manifest that lets a package be built from the directory later.

const product = (erc) => ({
  externalReferenceCode: erc,
  name: { en_US: erc },
  skus: [{ sku: `${erc}-SKU` }],
});

const buildContext = ({ addAttachment, addImage } = {}) => {
  const errors = [];

  return {
    errors,
    ctx: {
      logger: {
        info: () => {},
        warn: () => {},
        error: (message) => errors.push(message),
        debug: () => {},
      },
      liferay: {
        addProductImageByBase64: addImage || (async () => ({})),
        addProductDocumentAttachmentByBase64:
          addAttachment || (async () => ({})),
      },
      progress: {
        batchStarted: () => {},
        batchProgress: () => {},
        batchCompleted: () => {},
        batchFailed: () => {},
      },
      ai: {},
    },
  };
};

const IMAGE_BYTES = Buffer.from('the-image-bytes');
const PDF_BYTES = Buffer.from('the-pdf-bytes');

// 'custom' is the one mode that neither calls a provider nor fetches a URL, so
// the generator runs end to end with no network stub between the write and the
// upload - which is the ordering under test.
const optionsFor = (sessionId) => ({
  sessionId,
  correlationId: 'C1',
  imageMode: 'custom',
  imageRatio: 100,
  customImageFile: { buffer: IMAGE_BYTES, mime: 'image/png' },
  pdfMode: 'custom',
  pdfRatio: 100,
  customPdfFile: { buffer: PDF_BYTES },
});

const sessionDir = (sessionId) => path.join(ROOT, sessionId);

const readManifest = (sessionId) =>
  JSON.parse(
    fs.readFileSync(path.join(sessionDir(sessionId), MANIFEST_FILE), 'utf8')
  );

let counter = 0;
const nextSession = () => `S-${process.pid}-${++counter}`;

afterAll(() => {
  fs.rmSync(ROOT, { force: true, recursive: true });
});

describe('Generated media written to disk as it is made', () => {
  it('lands the bytes and a manifest entry for every upload', async () => {
    const sessionId = nextSession();
    const { ctx } = buildContext();
    const generator = new MediaGenerator(ctx);

    await generator.createImages({}, [product('P1')], optionsFor(sessionId));
    await generator.createPdfs({}, [product('P1')], optionsFor(sessionId));

    const manifest = readManifest(sessionId);

    expect(manifest.counts).toEqual({ images: 1, pdfs: 1, unresolved: 0 });

    const image = manifest.files.find((file) => file.kind === KIND.IMAGE);
    const pdf = manifest.files.find((file) => file.kind === KIND.PDF);

    // The layout #848 asked for: the ERC and the priority for a picture, the
    // ERC and the SKU for a document.
    expect(image.file).toBe('images/P1-1.png');
    expect(pdf.file).toBe('pdfs/P1-P1-SKU.pdf');

    expect(
      fs.readFileSync(path.join(sessionDir(sessionId), image.file))
    ).toEqual(IMAGE_BYTES);
    expect(fs.readFileSync(path.join(sessionDir(sessionId), pdf.file))).toEqual(
      PDF_BYTES
    );

    expect(image).toMatchObject({
      contentType: 'image/png',
      kind: KIND.IMAGE,
      priority: 1,
      productERC: 'P1',
    });
  });

  it('leaves the file behind when Liferay rejects the upload', async () => {
    const sessionId = nextSession();
    const { ctx, errors } = buildContext({
      addImage: async () => {
        throw new Error('413 Payload Too Large');
      },
    });

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('P2')],
      optionsFor(sessionId)
    );

    // The upload failed, so nothing is recorded as created - but the bytes are
    // on disk, which is the whole point: the picture is retryable rather than
    // gone.
    expect(created).toEqual([]);
    expect(errors.join(' ')).toContain('413 Payload Too Large');

    const manifest = readManifest(sessionId);
    expect(manifest.files).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(sessionDir(sessionId), manifest.files[0].file))
    ).toEqual(IMAGE_BYTES);

    // No upload response means no reference to record against it.
    expect(manifest.files[0]).not.toHaveProperty('attachmentERC');
  });

  it('records the attachment ERC and src the upload answered with', async () => {
    const sessionId = nextSession();
    const { ctx } = buildContext({
      addImage: async () => ({
        id: 4242,
        externalReferenceCode: 'AICAIMG-1',
        src: '/o/commerce-media/images/4242',
      }),
    });

    await new MediaGenerator(ctx).createImages(
      {},
      [product('P3')],
      optionsFor(sessionId)
    );

    expect(readManifest(sessionId).files[0]).toMatchObject({
      attachmentERC: 'AICAIMG-1',
      src: '/o/commerce-media/images/4242',
    });
  });

  it('does not stop the run when the disk refuses, and says so', async () => {
    const sessionId = nextSession();

    // A file where the session directory should go. mkdir fails, which is the
    // same shape as a read-only volume or a full one without needing either.
    fs.writeFileSync(sessionDir(sessionId), 'not a directory');

    const { ctx, errors } = buildContext({
      addImage: async () => ({ externalReferenceCode: 'AICAIMG-2' }),
    });

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('P4')],
      optionsFor(sessionId)
    );

    // Media is decoration and the model call is already paid for, so the run
    // finishes and the upload still happened.
    expect(created).toHaveLength(1);
    expect(created[0].attachmentERC).toBe('AICAIMG-2');

    // But it is not silent.
    expect(errors.join(' ')).toContain('media archive');
    expect(errors.join(' ')).toContain(sessionId);
  });

  it('records what it could not write rather than dropping it quietly', async () => {
    const sessionId = nextSession();

    // The session directory opens; the images directory cannot be created.
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    fs.writeFileSync(path.join(sessionDir(sessionId), 'images'), 'in the way');

    const { ctx, errors } = buildContext();

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('P5')],
      optionsFor(sessionId)
    );

    expect(created).toHaveLength(1);
    expect(errors.join(' ')).toContain('P5');

    const manifest = readManifest(sessionId);
    expect(manifest.files).toHaveLength(0);
    expect(manifest.counts.unresolved).toBe(1);
    expect(manifest.unresolved[0].productERC).toBe('P5');
    expect(manifest.unresolved[0].reason).toBeTruthy();
  });

  it('gives two pictures for one product at one priority separate names', async () => {
    const sessionId = nextSession();
    const { ctx } = buildContext();
    const generator = new MediaGenerator(ctx);

    await generator.createImages({}, [product('P6')], optionsFor(sessionId));
    await generator.createImages({}, [product('P6')], optionsFor(sessionId));

    const files = readManifest(sessionId).files.map((file) => file.file);

    expect(new Set(files).size).toBe(2);
    expect(files).toContain('images/P6-1.png');
  });

  it('flattens an ERC that would otherwise escape the directory', async () => {
    const sessionId = nextSession();
    const { ctx } = buildContext();

    await new MediaGenerator(ctx).createImages(
      {},
      [product('../../etc/P7 №1')],
      optionsFor(sessionId)
    );

    const entry = readManifest(sessionId).files[0];

    expect(entry.productERC).toBe('../../etc/P7 №1');
    expect(entry.file).not.toContain('..');
    expect(fs.existsSync(path.join(sessionDir(sessionId), entry.file))).toBe(
      true
    );
  });
});

// The manifest is worth nothing if it drifts from the format the bundle reads,
// so these assert against `utils/mediaBundle.cjs` itself rather than restating
// its shape here.
describe('The manifest is the one the bundle already builds', () => {
  const bundleManifestFor = async (media) =>
    (await buildMediaBundle({ dataset: {}, media })).manifest;

  it('carries the same version and the same entry fields', async () => {
    const sessionId = nextSession();
    const { ctx } = buildContext();

    await new MediaGenerator(ctx).createImages(
      {},
      [product('P8')],
      optionsFor(sessionId)
    );

    const manifest = readManifest(sessionId);
    const bundle = await bundleManifestFor([
      {
        buffer: IMAGE_BYTES,
        contentType: 'image/png',
        kind: KIND.IMAGE,
        priority: 1,
        productERC: 'P8',
        title: { en_US: 'P8 Custom Image' },
      },
    ]);

    expect(manifest.version).toBe(BUNDLE_VERSION);
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(bundle).sort());
    expect(Object.keys(manifest.counts).sort()).toEqual(
      Object.keys(bundle.counts).sort()
    );

    // An upload that returned no reference produces exactly the bundle's
    // fields; the reference fields are the only permitted additions.
    expect(Object.keys(manifest.files[0]).sort()).toEqual(
      Object.keys(bundle.files[0]).sort()
    );
  });

  it('chooses the same file extension the bundle chooses', async () => {
    for (const [contentType, extension] of Object.entries(EXTENSIONS)) {
      const bundle = await bundleManifestFor([
        {
          buffer: Buffer.from('x'),
          contentType,
          kind: contentType === 'application/pdf' ? KIND.PDF : KIND.IMAGE,
          priority: 1,
          productERC: 'P',
        },
      ]);

      expect(bundle.files[0].file.split('.').pop()).toBe(extension);
    }
  });

  it('builds a package straight from the directory with no translation', async () => {
    const sessionId = nextSession();
    const { ctx } = buildContext();
    const generator = new MediaGenerator(ctx);

    await generator.createImages({}, [product('P9')], optionsFor(sessionId));
    await generator.createPdfs({}, [product('P9')], optionsFor(sessionId));

    // This is the export #848 is for: read the manifest, read the files, hand
    // the entries to the bundle unchanged.
    const manifest = readManifest(sessionId);
    const media = manifest.files.map((file) => ({
      ...file,
      buffer: fs.readFileSync(path.join(sessionDir(sessionId), file.file)),
    }));

    const { buffer } = await buildMediaBundle({
      dataset: { products: [product('P9')] },
      media,
    });

    const unpacked = await readMediaBundle(buffer);

    expect(unpacked.missing).toEqual([]);
    expect(unpacked.manifest.counts).toEqual({
      images: 1,
      pdfs: 1,
      unresolved: 0,
    });
    expect(
      unpacked.media.map((item) => ({
        contentType: item.contentType,
        kind: item.kind,
        productERC: item.productERC,
        bytes: item.buffer.toString(),
      }))
    ).toEqual([
      {
        bytes: IMAGE_BYTES.toString(),
        contentType: 'image/png',
        kind: KIND.IMAGE,
        productERC: 'P9',
      },
      {
        bytes: PDF_BYTES.toString(),
        contentType: 'application/pdf',
        kind: KIND.PDF,
        productERC: 'P9',
      },
    ]);
  });
});

// Logs at least rotate. Without this, the feature is a slow disk leak on a
// long-lived instance - which is the objection #848 asked to answer, not duck.
describe('Retention', () => {
  const withRoot = (fn) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-media-prune-'));
    try {
      return fn(root);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  };

  const session = (root, name, ageHours) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    const when = new Date(Date.now() - ageHours * 60 * 60 * 1000);
    fs.utimesSync(dir, when, when);
    return dir;
  };

  it('drops session directories older than the retention window', () => {
    withRoot((root) => {
      const old = session(root, 'old', 100);
      const recent = session(root, 'recent', 1);

      pruneArchiveRoot(root, {
        keep: 'current',
        maxSessions: 100,
        retentionHours: 72,
      });

      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(recent)).toBe(true);
    });
  });

  it('drops the oldest beyond the session cap even inside the window', () => {
    withRoot((root) => {
      const first = session(root, 'first', 5);
      const second = session(root, 'second', 3);
      const third = session(root, 'third', 1);

      // The cap counts the session about to be written, so a cap of 3 leaves
      // two of these behind.
      pruneArchiveRoot(root, {
        keep: 'current',
        maxSessions: 3,
        retentionHours: 72,
      });

      expect(fs.existsSync(first)).toBe(false);
      expect(fs.existsSync(second)).toBe(true);
      expect(fs.existsSync(third)).toBe(true);
    });
  });

  it('never prunes the session being written', () => {
    withRoot((root) => {
      const current = session(root, 'current', 1000);

      const archive = openMediaArchive({
        logger: { error: () => {} },
        maxSessions: 1,
        retentionHours: 1,
        root,
        sessionId: 'current',
      });

      expect(archive.enabled).toBe(true);
      expect(fs.existsSync(current)).toBe(true);
    });
  });
});

describe('Switched off', () => {
  it('writes nothing and still returns a usable archive', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-media-off-'));

    try {
      const archive = openMediaArchive({
        enabled: false,
        root,
        sessionId: 'off',
      });

      // A no-op rather than a null, so the generator has no `if (archive)` at
      // every call site.
      expect(archive.record({ base64: 'AA==', kind: KIND.IMAGE })).toBeNull();
      expect(() => archive.link(null, {})).not.toThrow();
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});
