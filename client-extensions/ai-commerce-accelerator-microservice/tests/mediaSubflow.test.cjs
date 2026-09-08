const generateRoute = require('../routes/generate.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const { buildMediaSubflow } = require('../utils/mediaSubflow.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

const flattenStepNames = (steps) =>
  steps.flatMap((step) =>
    Array.isArray(step.steps) ? flattenStepNames(step.steps) : [step.name]
  );

const indexOfStep = (steps, name) => flattenStepNames(steps).indexOf(name);

describe('Media subflow composition', () => {
  it('places images and PDFs in their own subflow, and not inventory', () => {
    const subflow = buildMediaSubflow();

    expect(subflow.name).toBe('subflow-media');
    expect(flattenStepNames([subflow])).toEqual([
      S.ATTACH_IMAGES,
      S.ATTACH_PDFS,
    ]);
    expect(flattenStepNames([subflow])).not.toContain(S.UPDATE_INVENTORY);
  });
});

describe('Generate workflow step ordering', () => {
  let routeHandler;
  let createSession;

  const runRoute = async (options) => {
    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        channelId: '1',
        siteGroupId: '2',
        catalogId: '3',
        ...options,
      },
      files: {},
      headers: { 'x-correlation-id': 'corr-1' },
      correlationId: 'corr-1',
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await routeHandler(req, res);

    return { req, res };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    createSession = vi.fn().mockResolvedValue({});

    const mockApp = {
      post: vi.fn().mockImplementation((_path, _upload, handler) => {
        routeHandler = handler;
      }),
    };

    generateRoute(mockApp, {
      liferayService: {
        getChannels: vi.fn().mockResolvedValue([{ id: 1, siteGroupId: 2 }]),
        getCatalogs: vi.fn().mockResolvedValue([{ id: 3 }]),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      progressService: { sessionStarted: vi.fn(), emitError: vi.fn() },
      persistenceService: { createSession },
      batchCallbackService: { _checkSessionCompletion: vi.fn() },
      // Without a resolvable AI key the route diverts to the seed-pack flow.
      configService: {
        getAIConfig: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
        getAIKey: vi.fn().mockResolvedValue('test-key'),
      },
      commerceSiteTypeService: null,
    });
  });

  it('runs media after orders and promotions rather than inside the product steps', async () => {
    await runRoute({
      productCount: '5',
      accountCount: '2',
      orderCount: '3',
      generatePromotions: 'true',
    });

    expect(createSession).toHaveBeenCalled();
    const { steps } = createSession.mock.calls[0][0].context;

    const productSubflow = steps
      .flatMap((s) => s.steps || [])
      .find((s) => s.name === 'subflow-products');

    expect(flattenStepNames([productSubflow])).not.toContain(S.ATTACH_IMAGES);
    expect(flattenStepNames([productSubflow])).not.toContain(S.ATTACH_PDFS);
    expect(flattenStepNames([productSubflow])).toContain(S.UPDATE_INVENTORY);

    expect(steps.at(-1).name).toBe('subflow-media');
    expect(indexOfStep(steps, S.ATTACH_IMAGES)).toBeGreaterThan(
      indexOfStep(steps, S.CREATE_ORDERS)
    );
    expect(indexOfStep(steps, S.ATTACH_IMAGES)).toBeGreaterThan(
      indexOfStep(steps, S.CREATE_PROMOTIONS)
    );
    expect(indexOfStep(steps, S.ATTACH_PDFS)).toBeGreaterThan(
      indexOfStep(steps, S.CREATE_ORDERS)
    );
  });

  it('omits the media subflow when no products are generated', async () => {
    await runRoute({ productCount: '0', accountCount: '2', orderCount: '0' });

    const { steps } = createSession.mock.calls[0][0].context;

    expect(flattenStepNames(steps)).not.toContain(S.ATTACH_IMAGES);
    expect(flattenStepNames(steps)).not.toContain(S.ATTACH_PDFS);
  });
});

describe('Media step failure handling', () => {
  let productGenerator;
  let mockPersistence;
  let mockProgress;
  let mockMedia;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPersistence = {
      getSession: vi.fn().mockResolvedValue({
        session_id: 'sess-1',
        flow_type: 'generate',
        correlationId: 'corr-1',
        context: {
          config: {},
          options: {},
          productDataList: [{ externalReferenceCode: 'ERC1' }],
        },
      }),
      updateSessionContext: vi.fn().mockResolvedValue({}),
      createBatch: vi.fn().mockResolvedValue({}),
    };

    mockProgress = {
      stepWarning: vi.fn(),
      stepCompleted: vi.fn(),
      batchStarted: vi.fn(),
      batchCompleted: vi.fn(),
    };

    mockMedia = {
      createImages: vi.fn().mockResolvedValue([{ productERC: 'ERC1' }]),
      createPdfs: vi.fn().mockResolvedValue([{ productERC: 'ERC1' }]),
    };

    productGenerator = new ProductGenerator({
      persistence: mockPersistence,
      progress: mockProgress,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      media: mockMedia,
    });

    productGenerator.completeSyncStep = vi.fn().mockResolvedValue(true);
  });

  it.each([
    [S.ATTACH_IMAGES, 'createImages', 'createdImages'],
    [S.ATTACH_PDFS, 'createPdfs', 'createdPdfs'],
  ])(
    '%s records what it created and completes the step normally',
    async (stepKey, mediaMethod, contextKey) => {
      await productGenerator.steps[stepKey]('sess-1');

      expect(mockMedia[mediaMethod]).toHaveBeenCalled();
      expect(mockPersistence.updateSessionContext).toHaveBeenCalledWith(
        'sess-1',
        { [contextKey]: [{ productERC: 'ERC1' }] }
      );
      expect(productGenerator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        stepKey
      );
      expect(mockProgress.stepWarning).not.toHaveBeenCalled();
    }
  );

  it.each([
    [S.ATTACH_IMAGES, 'createImages'],
    [S.ATTACH_PDFS, 'createPdfs'],
  ])(
    '%s warns instead of failing the session when media generation throws',
    async (stepKey, mediaMethod) => {
      mockMedia[mediaMethod].mockRejectedValue(
        new Error('429 You have no credits remaining')
      );

      await expect(
        productGenerator.steps[stepKey]('sess-1')
      ).resolves.not.toThrow();

      expect(mockProgress.stepWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          step: stepKey,
          message: expect.stringContaining('429 You have no credits remaining'),
        })
      );

      const batch = mockPersistence.createBatch.mock.calls[0][0];
      expect(batch.stepKey).toBe(stepKey);
      expect(batch.status).toBe('BYPASSED');

      expect(
        mockPersistence.createBatch.mock.calls.some(
          ([b]) => b.status === 'FAILED'
        )
      ).toBe(false);

      // A completed step would mark the entity 100% produced in the UI.
      expect(productGenerator.completeSyncStep).not.toHaveBeenCalled();
    }
  );
});
