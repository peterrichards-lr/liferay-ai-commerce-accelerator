const generateMediaRoute = require('../routes/generateMedia.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const {
  MEDIA_SCOPES,
  selectProductsForMedia,
} = require('../utils/mediaScope.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

const product = (erc) => ({ externalReferenceCode: erc, name: { en_US: erc } });

const flattenStepNames = (steps) =>
  steps.flatMap((step) =>
    Array.isArray(step.steps) ? flattenStepNames(step.steps) : [step.name]
  );

describe('Media scope selection', () => {
  const context = {
    productDataList: [product('P1'), product('P2'), product('P3')],
    createdImages: [{ productERC: 'P1' }],
    createdPdfs: [{ productERC: 'P1' }, { productERC: 'P2' }],
  };

  it('scopes images and PDFs independently to what each is missing', () => {
    const { imageProducts, pdfProducts } = selectProductsForMedia(context, {
      scope: MEDIA_SCOPES.MISSING,
    });

    expect(imageProducts.map((p) => p.externalReferenceCode)).toEqual([
      'P2',
      'P3',
    ]);
    expect(pdfProducts.map((p) => p.externalReferenceCode)).toEqual(['P3']);
  });

  it('treats every product as missing media when the session recorded none', () => {
    const imported = { productDataList: context.productDataList };

    const { imageProducts, pdfProducts } = selectProductsForMedia(imported);

    expect(imageProducts).toHaveLength(3);
    expect(pdfProducts).toHaveLength(3);
  });

  it('covers every product under the all scope', () => {
    const { imageProducts, pdfProducts } = selectProductsForMedia(context, {
      scope: MEDIA_SCOPES.ALL,
    });

    expect(imageProducts).toHaveLength(3);
    expect(pdfProducts).toHaveLength(3);
  });

  it('narrows to named products before applying the scope', () => {
    const { imageProducts } = selectProductsForMedia(context, {
      scope: MEDIA_SCOPES.MISSING,
      externalReferenceCodes: ['P1', 'P3'],
    });

    expect(imageProducts.map((p) => p.externalReferenceCode)).toEqual(['P3']);
  });
});

// A product may carry a gallery rather than a single picture, from the picsum
// path or from a bundle built off a live instance (#852), so "has images" and
// "has all its images" stopped being the same question (#851).
describe('Media scope selection against a declared gallery', () => {
  const image = (productERC, title, priority, extra = {}) => ({
    kind: 'image',
    priority,
    productERC,
    title: { en_US: title },
    ...extra,
  });

  const pdf = (productERC, title, extra = {}) => ({
    kind: 'pdf',
    priority: 1,
    productERC,
    title: { en_US: title },
    ...extra,
  });

  const gallery = (productERC) => [
    image(productERC, `${productERC} main`, 1),
    image(productERC, `${productERC} thumb`, 2),
    image(productERC, `${productERC} alt`, 3),
  ];

  const select = (context, expectedMedia) =>
    selectProductsForMedia(context, {
      expectedMedia,
      scope: MEDIA_SCOPES.MISSING,
    });

  it('skips a product holding every image declared for it', () => {
    const { imageProducts } = select(
      {
        productDataList: [product('P1')],
        createdImages: gallery('P1'),
      },
      gallery('P1')
    );

    expect(imageProducts).toHaveLength(0);
  });

  it('selects a product holding some but not all of its images', () => {
    const { imageProducts } = select(
      {
        productDataList: [product('P1'), product('P2')],
        createdImages: [...gallery('P1'), gallery('P2')[0]],
      },
      [...gallery('P1'), ...gallery('P2')]
    );

    expect(imageProducts.map((p) => p.externalReferenceCode)).toEqual(['P2']);
  });

  // The question the count answer gets wrong: three declared against three
  // unrelated files is a product that lost all three, not a product that is
  // complete.
  it('selects a product whose images were replaced rather than kept', () => {
    const { imageProducts } = select(
      {
        productDataList: [product('P1')],
        createdImages: [
          image('P1', 'Something else', 1),
          image('P1', 'Something else again', 2),
          image('P1', 'And another', 3),
        ],
      },
      gallery('P1')
    );

    expect(imageProducts).toHaveLength(1);
  });

  it('recognises a file by its attachment reference whatever it is titled', () => {
    const declared = [
      image('P1', 'As the source titled it', 1, { attachmentERC: 'ATT-1' }),
    ];

    const { imageProducts } = select(
      {
        productDataList: [product('P1')],
        createdImages: [
          image('P1', 'As the target titled it', 7, {
            attachmentERC: 'ATT-1',
          }),
        ],
      },
      declared
    );

    expect(imageProducts).toHaveLength(0);
  });

  it('treats the same title at a different priority as a different file', () => {
    const { imageProducts } = select(
      {
        productDataList: [product('P1')],
        createdImages: [image('P1', 'P1 main', 1)],
      },
      [image('P1', 'P1 main', 1), image('P1', 'P1 main', 2)]
    );

    expect(imageProducts).toHaveLength(1);
  });

  // Entries written before #838 carry no attachment reference, and one written
  // by a run that had no title to record carries nothing comparable at all.
  // Counting is what is left, and it is still better than "has one, so done".
  it('falls back to counting entries that carry no identity at all', () => {
    const anonymous = { kind: 'image', productERC: 'P1' };

    const short = select(
      {
        productDataList: [product('P1')],
        createdImages: [{ productERC: 'P1' }],
      },
      [anonymous, anonymous, anonymous]
    );

    expect(short.imageProducts).toHaveLength(1);

    const whole = select(
      {
        productDataList: [product('P1')],
        createdImages: [
          { productERC: 'P1' },
          { productERC: 'P1' },
          { productERC: 'P1' },
        ],
      },
      [anonymous, anonymous, anonymous]
    );

    expect(whole.imageProducts).toHaveLength(0);
  });

  it('compares a pre-#838 record on title and priority', () => {
    const { imageProducts } = select(
      {
        productDataList: [product('P1')],
        // No attachmentERC and no src: an entry recorded before #838.
        createdImages: [image('P1', 'P1 main', 1), image('P1', 'P1 alt', 3)],
      },
      gallery('P1')
    );

    expect(imageProducts).toHaveLength(1);
  });

  it('keeps a declaration of one kind out of the other', () => {
    const context = {
      productDataList: [product('P1')],
      createdImages: [gallery('P1')[0]],
      createdPdfs: [pdf('P1', 'P1 manual')],
    };

    const { imageProducts, pdfProducts } = select(context, [
      ...gallery('P1'),
      pdf('P1', 'P1 manual'),
    ]);

    expect(imageProducts).toHaveLength(1);
    expect(pdfProducts).toHaveLength(0);
  });

  it('ignores a declaration that names no kind', () => {
    const { imageProducts, pdfProducts } = select(
      {
        productDataList: [product('P1')],
        createdImages: [gallery('P1')[0]],
        createdPdfs: [pdf('P1', 'P1 manual')],
      },
      gallery('P1').map(({ kind: _kind, ...rest }) => rest)
    );

    expect(imageProducts).toHaveLength(0);
    expect(pdfProducts).toHaveLength(0);
  });

  // The declaration says what a product should hold, never what it should not:
  // a product a bundle carried nothing for is still one a later run can
  // illustrate, which is what a media-only run over an import is usually for.
  it('still selects a product the declaration does not name', () => {
    const { imageProducts } = select(
      {
        productDataList: [product('P1'), product('P2')],
        createdImages: gallery('P1'),
      },
      gallery('P1')
    );

    expect(imageProducts.map((p) => p.externalReferenceCode)).toEqual(['P2']);
  });

  it('reads the declaration from a manifest the session carries', () => {
    const context = {
      productDataList: [product('P1')],
      createdImages: [gallery('P1')[0]],
      mediaManifest: { files: gallery('P1') },
    };

    const { imageProducts } = selectProductsForMedia(context, {
      scope: MEDIA_SCOPES.MISSING,
    });

    expect(imageProducts).toHaveLength(1);
  });

  it('accepts a whole manifest as the declaration', () => {
    const { imageProducts } = select(
      {
        productDataList: [product('P1')],
        createdImages: [gallery('P1')[0]],
      },
      { files: gallery('P1'), unresolved: [] }
    );

    expect(imageProducts).toHaveLength(1);
  });

  it('covers a declared product under the all scope regardless', () => {
    const { imageProducts } = selectProductsForMedia(
      {
        productDataList: [product('P1')],
        createdImages: gallery('P1'),
      },
      { expectedMedia: gallery('P1'), scope: MEDIA_SCOPES.ALL }
    );

    expect(imageProducts).toHaveLength(1);
  });
});

describe('Media-only run route', () => {
  let routeHandler;
  let createSession;
  let getSession;

  const sourceSession = {
    session_id: 'src-1',
    session_name: 'Imported dataset',
    context: {
      productDataList: [product('P1'), product('P2'), product('P3')],
      createdImages: [{ productERC: 'P1' }],
    },
  };

  const post = async (body) => {
    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        imageMode: 'placeholder',
        pdfMode: 'placeholder',
        ...body,
      },
      files: {},
      headers: {},
      correlationId: 'corr-1',
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await routeHandler(req, res);

    return res;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    createSession = vi.fn().mockResolvedValue({});
    getSession = vi.fn().mockResolvedValue(sourceSession);

    generateMediaRoute(
      {
        post: vi.fn().mockImplementation((_path, _upload, handler) => {
          routeHandler = handler;
        }),
      },
      {
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
        progressService: { sessionStarted: vi.fn(), emitError: vi.fn() },
        persistenceService: { createSession, getSession },
        batchCallbackService: { _checkSessionCompletion: vi.fn() },
      }
    );
  });

  it('refuses to start without an explicit confirmation', async () => {
    const res = await post({ sourceSessionId: 'src-1' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuses to start without a source session', async () => {
    const res = await post({ confirmMediaGeneration: 'true' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('reports an unknown source session', async () => {
    getSession.mockResolvedValue(null);

    const res = await post({
      sourceSessionId: 'nope',
      confirmMediaGeneration: 'true',
    });

    expect(res.status).toHaveBeenCalledWith(404);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuses when neither images nor PDFs were asked for', async () => {
    const res = await post({
      sourceSessionId: 'src-1',
      confirmMediaGeneration: 'true',
      imageMode: 'none',
      pdfMode: 'none',
    });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('builds a media-only flow that creates no commerce data', async () => {
    await post({ sourceSessionId: 'src-1', confirmMediaGeneration: 'true' });

    expect(createSession).toHaveBeenCalled();
    const session = createSession.mock.calls[0][0];

    expect(session.flowType).toBe('media');
    expect(flattenStepNames(session.context.steps)).toEqual([
      S.SYNC_DELAY_MEDIA,
      S.ATTACH_IMAGES,
      S.ATTACH_PDFS,
    ]);
    expect(flattenStepNames(session.context.steps)).not.toContain(
      S.CREATE_PRODUCTS
    );
  });

  it('scopes each step to the products missing that kind of media', async () => {
    const res = await post({
      sourceSessionId: 'src-1',
      confirmMediaGeneration: 'true',
    });

    const { context } = createSession.mock.calls[0][0];

    expect(
      context.imageProductDataList.map((p) => p.externalReferenceCode)
    ).toEqual(['P2', 'P3']);
    expect(
      context.pdfProductDataList.map((p) => p.externalReferenceCode)
    ).toEqual(['P1', 'P2', 'P3']);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, imageCount: 2, pdfCount: 3 })
    );
  });

  it('covers every product when asked for the all scope', async () => {
    await post({
      sourceSessionId: 'src-1',
      confirmMediaGeneration: 'true',
      mediaScope: 'all',
    });

    const { context } = createSession.mock.calls[0][0];

    expect(context.imageProductDataList).toHaveLength(3);
  });

  it('does nothing when every product already has the media requested', async () => {
    getSession.mockResolvedValue({
      session_id: 'src-2',
      context: {
        productDataList: [product('P1')],
        createdImages: [{ productERC: 'P1' }],
        createdPdfs: [{ productERC: 'P1' }],
      },
    });

    const res = await post({
      sourceSessionId: 'src-2',
      confirmMediaGeneration: 'true',
    });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('Media steps under a media-only run', () => {
  let productGenerator;
  let mockMedia;

  const buildGenerator = (context) => {
    mockMedia = {
      createImages: vi.fn().mockResolvedValue([]),
      createPdfs: vi.fn().mockResolvedValue([]),
    };

    const generator = new ProductGenerator({
      persistence: {
        getSession: vi.fn().mockResolvedValue({
          session_id: 'sess-1',
          flow_type: 'media',
          context,
        }),
        updateSessionContext: vi.fn().mockResolvedValue({}),
        createBatch: vi.fn().mockResolvedValue({}),
      },
      progress: { stepWarning: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      media: mockMedia,
    });

    generator.completeSyncStep = vi.fn().mockResolvedValue(true);

    return generator;
  };

  it('attaches only the products each step was scoped to', async () => {
    productGenerator = buildGenerator({
      config: {},
      options: {},
      productDataList: [product('P1'), product('P2'), product('P3')],
      imageProductDataList: [product('P2'), product('P3')],
      pdfProductDataList: [product('P3')],
    });

    await productGenerator.steps[S.ATTACH_IMAGES]('sess-1');
    await productGenerator.steps[S.ATTACH_PDFS]('sess-1');

    expect(mockMedia.createImages.mock.calls[0][1]).toHaveLength(2);
    expect(mockMedia.createPdfs.mock.calls[0][1]).toHaveLength(1);
  });

  it('falls back to every product when no scope is present', async () => {
    productGenerator = buildGenerator({
      config: {},
      options: {},
      productDataList: [product('P1'), product('P2')],
    });

    await productGenerator.steps[S.ATTACH_IMAGES]('sess-1');

    expect(mockMedia.createImages.mock.calls[0][1]).toHaveLength(2);
  });

  it('registers a handler for the media sync delay', async () => {
    productGenerator = buildGenerator({ config: {}, options: {} });
    productGenerator._runInterServiceSyncDelayStep = vi
      .fn()
      .mockResolvedValue();

    await productGenerator.steps[S.SYNC_DELAY_MEDIA]('sess-1');

    expect(productGenerator._runInterServiceSyncDelayStep).toHaveBeenCalledWith(
      'sess-1',
      S.SYNC_DELAY_MEDIA
    );
  });
});
