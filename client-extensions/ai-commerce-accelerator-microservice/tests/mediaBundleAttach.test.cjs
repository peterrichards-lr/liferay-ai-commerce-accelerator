const MediaGenerator = require('../generators/mediaGenerator.cjs');

// The import half of #814: the bundle's bytes are attached to the target,
// rather than a model being asked for equivalent pictures.

const product = (erc) => ({
  externalReferenceCode: erc,
  name: { en_US: erc },
  skus: [{ sku: `${erc}-SKU` }],
});

const buildCtx = (bundled, { bundleKey = 'media-bundle:S1' } = {}) => {
  const attached = { images: [], pdfs: [] };
  const errors = [];
  const warnings = [];

  return {
    attached,
    errors,
    warnings,
    bundleKey,
    ctx: {
      cache: {
        get: (key) => (key === bundleKey ? bundled : undefined),
      },
      logger: {
        info: () => {},
        warn: (message) => warnings.push(message),
        error: (message) => errors.push(message),
        debug: () => {},
      },
      liferay: {
        addProductImageByBase64: async (_config, erc, payload) => {
          attached.images.push({ erc, ...payload });
          return { id: 1, src: '/o/media/1' };
        },
        addProductDocumentAttachmentByBase64: async (_config, erc, payload) => {
          attached.pdfs.push({ erc, ...payload });
          return { id: 2, src: '/o/media/2' };
        },
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

const bundledImage = (productERC, bytes) => ({
  buffer: Buffer.from(bytes),
  contentType: 'image/webp',
  kind: 'image',
  priority: 1,
  productERC,
  title: { en_US: `${productERC} picture` },
});

const options = (bundleKey) => ({
  correlationId: 'C1',
  imageMode: 'bundle',
  imageRatio: 100,
  mediaBundleKey: bundleKey,
  pdfMode: 'bundle',
  pdfRatio: 100,
  sessionId: 'S1',
});

describe('Attaching a bundle to the target', () => {
  it('uploads the bundled bytes, not a regenerated picture', async () => {
    const { attached, ctx, bundleKey } = buildCtx([
      bundledImage('AICA-PRD-1', 'the-original-bytes'),
    ]);

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('AICA-PRD-1')],
      options(bundleKey)
    );

    expect(attached.images).toHaveLength(1);
    // The bytes are what makes this a promotion rather than a regeneration.
    expect(
      Buffer.from(attached.images[0].attachment, 'base64').toString()
    ).toBe('the-original-bytes');
    expect(attached.images[0].title).toEqual({ en_US: 'AICA-PRD-1 picture' });
    expect(created).toHaveLength(1);
  });

  it('attaches every PDF a product carried, not just the first', async () => {
    const { attached, ctx, bundleKey } = buildCtx([
      {
        buffer: Buffer.from('manual'),
        contentType: 'application/pdf',
        kind: 'pdf',
        priority: 1,
        productERC: 'AICA-PRD-1',
        title: { en_US: 'manual.pdf' },
      },
      {
        buffer: Buffer.from('warranty'),
        contentType: 'application/pdf',
        kind: 'pdf',
        priority: 2,
        productERC: 'AICA-PRD-1',
        title: { en_US: 'warranty.pdf' },
      },
    ]);

    // A generated run makes one PDF per product; a bundle reflects whatever
    // the source actually held, which may be several.
    const created = await new MediaGenerator(ctx).createPdfs(
      {},
      [product('AICA-PRD-1')],
      options(bundleKey)
    );

    expect(attached.pdfs).toHaveLength(2);
    expect(created).toHaveLength(2);
    expect(attached.pdfs.map((p) => p.title.en_US)).toEqual([
      'manual.pdf',
      'warranty.pdf',
    ]);
  });

  it('attaches every image a product carried, in priority order', async () => {
    // The generator makes one image per product on most paths, so nothing
    // upstream exercised multiples. A real instance is under no such
    // restriction, and extract reflects whatever it actually holds (#814).
    const { attached, ctx, bundleKey } = buildCtx([
      {
        buffer: Buffer.from('main-shot'),
        contentType: 'image/webp',
        kind: 'image',
        priority: 1,
        productERC: 'AICA-PRD-1',
        title: { en_US: 'main' },
      },
      {
        buffer: Buffer.from('alt-shot'),
        contentType: 'image/png',
        kind: 'image',
        priority: 2,
        productERC: 'AICA-PRD-1',
        title: { en_US: 'alt' },
      },
      {
        buffer: Buffer.from('detail-shot'),
        contentType: 'image/webp',
        kind: 'image',
        priority: 3,
        productERC: 'AICA-PRD-1',
        title: { en_US: 'detail' },
      },
    ]);

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('AICA-PRD-1')],
      options(bundleKey)
    );

    expect(attached.images).toHaveLength(3);
    expect(created).toHaveLength(3);

    // Priority is how Liferay orders a gallery, so it has to travel with each
    // file rather than be re-derived from position.
    expect(attached.images.map((image) => image.priority)).toEqual([1, 2, 3]);
    expect(
      attached.images.map((image) =>
        Buffer.from(image.attachment, 'base64').toString()
      )
    ).toEqual(['main-shot', 'alt-shot', 'detail-shot']);

    // Content type is per file, not per product: a gallery can mix formats.
    expect(attached.images.map((image) => image.contentType)).toEqual([
      'image/webp',
      'image/png',
      'image/webp',
    ]);
  });

  it('gives each product only its own media', async () => {
    const { attached, ctx, bundleKey } = buildCtx([
      bundledImage('AICA-PRD-1', 'first'),
      bundledImage('AICA-PRD-2', 'second'),
    ]);

    await new MediaGenerator(ctx).createImages(
      {},
      [product('AICA-PRD-1')],
      options(bundleKey)
    );

    expect(attached.images).toHaveLength(1);
    expect(attached.images[0].erc).toBe('AICA-PRD-1');
  });

  it('fails loudly when the bundle is no longer held', async () => {
    const { ctx, errors } = buildCtx([bundledImage('AICA-PRD-1', 'x')], {
      bundleKey: 'media-bundle:S1',
    });

    // The cache is memory only, so a restart between upload and attach loses
    // it. Attaching nothing would report a promotion complete with no pictures
    // on it, which is the failure this whole feature exists to prevent.
    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('AICA-PRD-1')],
      options('media-bundle:GONE')
    );

    expect(created).toHaveLength(0);
    // Attaching nothing quietly is the failure mode; saying so is the point.
    expect(errors.join(' ')).toContain('AICA-PRD-1');
    expect(errors.join(' ')).toMatch(/bundle|re-upload/i);
  });

  it('records the reference Liferay returns for bundled media too', async () => {
    const { ctx, bundleKey } = buildCtx([bundledImage('AICA-PRD-1', 'bytes')]);

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('AICA-PRD-1')],
      options(bundleKey)
    );

    // #838 applies on this path as much as on a generated one.
    expect(created[0]).toMatchObject({ attachmentId: 1, src: '/o/media/1' });
  });
});
