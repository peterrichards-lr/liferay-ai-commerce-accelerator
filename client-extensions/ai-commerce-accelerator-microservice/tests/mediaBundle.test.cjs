const {
  DATASET_ENTRY,
  MANIFEST_ENTRY,
  buildMediaBundle,
  looksLikeZip,
  readMediaBundle,
} = require('../utils/mediaBundle.cjs');
const { resolveDatasetMedia } = require('../utils/mediaResolver.cjs');

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

describe('Media bundle round trip', () => {
  it('carries the dataset and every binary back out unchanged', async () => {
    const { buffer } = await buildMediaBundle({
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

  it('records what it could not resolve instead of dropping it', async () => {
    const { manifest } = await buildMediaBundle({
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

  it('reports a manifest entry whose file is absent from the archive', async () => {
    const { buffer } = await buildMediaBundle({
      dataset: DATASET,
      media: [image('AICA-PRD-1', 'ok')],
    });

    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(await zip.file(MANIFEST_ENTRY).async('string'));
    zip.remove(manifest.files[0].file);
    const tampered = await zip.generateAsync({ type: 'nodebuffer' });

    const read = await readMediaBundle(tampered);

    expect(read.media).toHaveLength(0);
    expect(read.missing).toHaveLength(1);
  });

  it('gives distinct entry names to two products with awkward codes', async () => {
    const { manifest } = await buildMediaBundle({
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
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('something-else.txt', 'not a dataset');

    await expect(
      readMediaBundle(await zip.generateAsync({ type: 'nodebuffer' }))
    ).rejects.toThrow(DATASET_ENTRY);
  });

  it('recognises a zip by its header, not its name', async () => {
    const { buffer } = await buildMediaBundle({ dataset: DATASET, media: [] });

    expect(looksLikeZip(buffer)).toBe(true);
    expect(looksLikeZip(Buffer.from(JSON.stringify(DATASET)))).toBe(false);
    expect(looksLikeZip(undefined)).toBe(false);
  });
});

describe('Resolving media from the source instance', () => {
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
    const media = await resolveDatasetMedia({
      config: {},
      liferayService,
      logger,
      products: DATASET.products,
    });

    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({
      kind: 'image',
      productERC: 'AICA-PRD-1',
    });
    expect(media[0].buffer.toString()).toBe('resolved-bytes');
  });

  it('costs one product its pictures when a lookup fails, not the promotion', async () => {
    const failing = {
      ...liferayService,
      getProductImages: async (_config, erc) => {
        if (erc === 'AICA-PRD-1') throw new Error('403 from the media servlet');
        return [{ contentType: 'image/webp', priority: 1, src: '/o/media/2' }];
      },
    };

    const media = await resolveDatasetMedia({
      config: {},
      liferayService: failing,
      logger,
      products: DATASET.products,
    });

    // The second product still resolves. Throwing would abandon a promotion
    // partway and leave the target an arbitrary prefix of the catalogue.
    const failed = media.find((m) => m.productERC === 'AICA-PRD-1');
    const ok = media.find((m) => m.productERC === 'AICA-PRD-2');

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

    await resolveDatasetMedia({
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
