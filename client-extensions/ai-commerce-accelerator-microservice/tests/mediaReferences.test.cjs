const MediaGenerator = require('../generators/mediaGenerator.cjs');

// A run that uploads media and keeps no reference to it leaves the export
// knowing only that a picture was made, not where it went - which is the
// lookup #814 has to perform product by product (#838).

const product = (erc) => ({
  externalReferenceCode: erc,
  name: { en_US: erc },
  skus: [{ sku: `${erc}-SKU` }],
});

const buildContext = (addImage, addAttachment) => {
  const warnings = [];

  return {
    warnings,
    ctx: {
      logger: {
        info: () => {},
        warn: (message) => warnings.push(message),
        error: () => {},
        debug: () => {},
      },
      liferay: {
        addProductImageByBase64: addImage,
        addProductDocumentAttachmentByBase64: addAttachment,
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

// 'custom' is the one mode that neither calls a provider nor fetches a URL,
// so the generator runs end to end without a network stub standing between
// the upload and what it returns.
const customImage = {
  buffer: Buffer.from('image-bytes'),
  mime: 'image/png',
};

const options = {
  sessionId: 'S1',
  correlationId: 'C1',
  imageMode: 'custom',
  imageRatio: 100,
  customImageFile: customImage,
  pdfMode: 'custom',
  pdfRatio: 100,
  customPdfFile: { buffer: Buffer.from('pdf-bytes') },
};

describe('Media references recorded from the upload response', () => {
  it('keeps the id, ERC and src Liferay returns for an image', async () => {
    const { ctx } = buildContext(
      async () => ({
        id: 4242,
        externalReferenceCode: 'AICAIMG-1',
        src: '/o/commerce-media/images/4242',
      }),
      async () => ({})
    );

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('P1')],
      options
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      productERC: 'P1',
      attachmentId: 4242,
      attachmentERC: 'AICAIMG-1',
      src: '/o/commerce-media/images/4242',
    });
  });

  it('keeps the id, ERC and src Liferay returns for a PDF', async () => {
    const { ctx } = buildContext(
      async () => ({}),
      async () => ({
        id: 99,
        externalReferenceCode: 'AICAATT-1',
        src: '/o/commerce-media/attachments/99',
      })
    );

    const created = await new MediaGenerator(ctx).createPdfs(
      {},
      [product('P1')],
      options
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      productERC: 'P1',
      attachmentId: 99,
      attachmentERC: 'AICAATT-1',
      src: '/o/commerce-media/attachments/99',
    });
  });

  it('records the media and says so when the response carries no reference', async () => {
    const { ctx, warnings } = buildContext(
      async () => ({}),
      async () => ({})
    );

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('P1')],
      options
    );

    // The upload succeeded, so the entry stands - but an entry that silently
    // held nothing locatable is exactly the quiet loss this guards against.
    expect(created).toHaveLength(1);
    expect(created[0].productERC).toBe('P1');
    expect(created[0]).not.toHaveProperty('src');
    expect(warnings.join(' ')).toContain('P1');
  });

  it('keeps whichever fields the response does carry', async () => {
    const { ctx, warnings } = buildContext(
      async () => ({ id: 7 }),
      async () => ({})
    );

    const created = await new MediaGenerator(ctx).createImages(
      {},
      [product('P1')],
      options
    );

    expect(created[0].attachmentId).toBe(7);
    expect(created[0]).not.toHaveProperty('attachmentERC');
    expect(warnings).toHaveLength(0);
  });
});
