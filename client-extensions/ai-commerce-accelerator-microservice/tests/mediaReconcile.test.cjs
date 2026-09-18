const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-media-reconcile-'));
process.env.MEDIA_ARCHIVE_PATH = ROOT;

const MediaGenerator = require('../generators/mediaGenerator.cjs');

/**
 * A second attempt must not attach a file the product already carries.
 *
 * Both media steps POSTed with no reference of its own and no existence check,
 * so nothing distinguished "attach this picture" from "attach this picture
 * again" and a rerun left the product holding both copies with no error to say
 * so (#1040). The stubs here only record and replay; every count is the
 * production code's.
 */

const IMAGE_BYTES = Buffer.from('the-image-bytes');
const PDF_BYTES = Buffer.from('the-pdf-bytes');

const product = (erc) => ({
  externalReferenceCode: erc,
  name: { en_US: erc },
  skus: [{ sku: `${erc}-SKU` }],
});

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

// One instance, standing in for Liferay: what is posted is what a later read
// returns, which is the only way a rerun can see what the first run did.
const buildInstance = () => {
  const images = new Map();
  const attachments = new Map();

  const store = (bucket) => async (_config, productERC, payload) => {
    const rows = bucket.get(productERC) || [];

    rows.push({ externalReferenceCode: payload.externalReferenceCode });
    bucket.set(productERC, rows);

    return {
      externalReferenceCode: payload.externalReferenceCode,
      id: rows.length,
    };
  };

  const read = (bucket) => async (_config, productERC) => ({
    items: bucket.get(productERC) || [],
  });

  return {
    images,
    attachments,
    ctx: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      liferay: {
        addProductImageByBase64: store(images),
        addProductDocumentAttachmentByBase64: store(attachments),
        getProductImages: read(images),
        getProductAttachments: read(attachments),
      },
      progress: {
        batchStarted() {},
        batchProgress() {},
        batchCompleted() {},
        batchFailed() {},
      },
      ai: {},
    },
  };
};

let counter = 0;
const nextSession = () => `R-${process.pid}-${++counter}`;

afterAll(() => fs.rmSync(ROOT, { force: true, recursive: true }));

describe('media attaches once, however many times the step runs', () => {
  it('attaches an image once across two runs', async () => {
    const instance = buildInstance();
    const generator = new MediaGenerator(instance.ctx);

    await generator.createImages(
      {},
      [product('P1')],
      optionsFor(nextSession())
    );
    await generator.createImages(
      {},
      [product('P1')],
      optionsFor(nextSession())
    );

    expect(instance.images.get('P1')).toHaveLength(1);
  });

  it('attaches a document once across two runs', async () => {
    const instance = buildInstance();
    const generator = new MediaGenerator(instance.ctx);

    await generator.createPdfs({}, [product('P2')], optionsFor(nextSession()));
    await generator.createPdfs({}, [product('P2')], optionsFor(nextSession()));

    expect(instance.attachments.get('P2')).toHaveLength(1);
  });

  it('gives the attachment a reference of its own', async () => {
    const instance = buildInstance();
    const generator = new MediaGenerator(instance.ctx);

    await generator.createImages(
      {},
      [product('P3')],
      optionsFor(nextSession())
    );

    const [row] = instance.images.get('P3');

    expect(row.externalReferenceCode).toMatch(/^AICA-IMG-/);
  });

  it('still attaches to a product that carries nothing', async () => {
    const instance = buildInstance();
    const generator = new MediaGenerator(instance.ctx);

    await generator.createImages(
      {},
      [product('P4')],
      optionsFor(nextSession())
    );

    expect(instance.images.get('P4')).toHaveLength(1);
  });

  it('attaches when the client cannot read what a product carries', async () => {
    // The duplicate check is a safeguard, not a prerequisite: a client with no
    // read must behave exactly as it did before #1040 rather than attach
    // nothing at all.
    const instance = buildInstance();

    delete instance.ctx.liferay.getProductImages;

    const generator = new MediaGenerator(instance.ctx);

    await generator.createImages(
      {},
      [product('P5')],
      optionsFor(nextSession())
    );

    expect(instance.images.get('P5')).toHaveLength(1);
  });
});
