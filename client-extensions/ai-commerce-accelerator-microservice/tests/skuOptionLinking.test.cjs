const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

/**
 * create-skus sent every option link as {optionId: 44862, optionValueId: 0},
 * Liferay refused the insert with ConstraintViolationException, and the whole
 * batch of SKUs was lost. These exercise the three shapes that produced it. See
 * #662.
 */
describe('SKU option links', () => {
  let generator;
  let liferay;
  let persistence;
  let logger;
  let session;
  let submitted;

  const product = () => ({
    id: 71551,
    externalReferenceCode: 'ERC1',
    name: { en_US: 'Trail Runner 500' },
    options: [
      {
        name: 'Color',
        fieldType: 'select',
        skuContributor: true,
        productOptionValues: ['Black', 'Silver'],
      },
    ],
    skus: [{ sku: 'TR500', externalReferenceCode: 'TR500', price: 120 }],
    skuVariants: [
      {
        sku: 'TR500-BLK',
        externalReferenceCode: 'TR500-BLK',
        options: { Color: 'Black' },
        price: 120,
      },
    ],
  });

  const linkedColour = (values) => ({
    id: 71565,
    optionId: 44862,
    key: 'COLOR',
    name: { en_US: 'Color' },
    ...(values ? { productOptionValues: values } : {}),
  });

  const liferayValues = [
    { id: 71566, key: 'BLACK', name: { en_US: 'Black' } },
    { id: 71567, key: 'SILVER', name: { en_US: 'Silver' } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    submitted = [];

    liferay = {
      createOptionWithReuse: vi
        .fn()
        .mockResolvedValue({ id: 44862, key: 'COLOR' }),
      addProductOptions: vi
        .fn()
        .mockResolvedValue({ items: [linkedColour(liferayValues)] }),
      getProductOptions: vi
        .fn()
        .mockResolvedValue([linkedColour(liferayValues)]),
      createProductsBatch: vi.fn().mockResolvedValue({ batchId: 'b1' }),
    };

    persistence = {
      getSession: vi.fn(),
      updateSessionContext: vi.fn().mockImplementation((_id, patch) => {
        Object.assign(session.context, patch);
      }),
      createBatch: vi.fn().mockResolvedValue({ id: 'batch-1' }),
      updateBatch: vi.fn().mockResolvedValue({}),
    };

    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    };

    generator = new ProductGenerator({
      liferay,
      persistence,
      logger,
      progress: { batchStarted: vi.fn(), batchCompleted: vi.fn() },
    });

    generator.completeSyncStep = vi.fn().mockResolvedValue({});
    generator.submitBatch = vi
      .fn()
      .mockImplementation(async (_sessionId, _step, _kind, _op, send) => {
        await send('BATCH-ERC');
      });
    liferay.createProductsBatch.mockImplementation(async (_cfg, batch) => {
      submitted.push(...batch);
      return { batchId: 'b1' };
    });

    session = {
      session_id: 'sess-1',
      correlationId: 'corr-1',
      context: {
        config: { catalogId: '123', batchSize: '10' },
        options: { generateSkuVariants: true },
        productDataList: [product()],
      },
    };
    persistence.getSession.mockResolvedValue(session);
  });

  const skuOptionsOf = () => submitted[0].skus[0].skuOptions;

  const runToSkus = async () => {
    await generator.steps[S.ENSURE_OPTIONS]('sess-1');
    await generator.steps[S.LINK_PRODUCT_OPTIONS]('sess-1');
    await generator.steps[S.CREATE_PRODUCT_SKUS]('sess-1');
  };

  it('sends the product definition relationship ids, not the global ones', async () => {
    // The global option is 44862 and its value definitions are elsewhere
    // entirely; Sku.skuOptions addresses 71565 / 71566.
    await runToSkus();

    expect(skuOptionsOf()).toEqual([{ optionId: 71565, optionValueId: 71566 }]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads the definition back when the write does not expand its values', async () => {
    // Nothing obliges POST /products/{id}/productOptions to answer with nested
    // productOptionValues. Without the read-back every value resolved to zero.
    liferay.addProductOptions.mockResolvedValue({ items: [linkedColour()] });

    await runToSkus();

    expect(liferay.getProductOptions).toHaveBeenCalledWith(
      session.context.config,
      71551
    );
    expect(skuOptionsOf()).toEqual([{ optionId: 71565, optionValueId: 71566 }]);
  });

  it('never seeds the SKU ids from ensure-options', async () => {
    // ensure-options resolves the global option, whose id is real and wrong
    // here. Before, it wrote to the same fields create-skus reads, so a failed
    // link produced {optionId: <global>, optionValueId: 0} - which Liferay
    // rejects, taking every SKU in the batch with it.
    liferay.addProductOptions.mockResolvedValue({ items: [] });
    liferay.getProductOptions.mockResolvedValue([]);

    await runToSkus();

    expect(skuOptionsOf()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped 1 option link'),
      expect.objectContaining({
        unresolved: [expect.stringContaining('Color=Black')],
      })
    );
  });

  it('leaves the global option id in place for a rerun', async () => {
    // link-product-options has to send ProductOption.optionId, which is the
    // global id. Overwriting it with the relationship id made the second run
    // send a CPDefinitionOptionRel id where Liferay wants a CPOption id.
    await generator.steps[S.ENSURE_OPTIONS]('sess-1');
    await generator.steps[S.LINK_PRODUCT_OPTIONS]('sess-1');
    await generator.steps[S.LINK_PRODUCT_OPTIONS]('sess-1');

    for (const call of liferay.addProductOptions.mock.calls) {
      expect(call[2][0].optionId).toBe(44862);
    }
  });

  it('matches the option Liferay echoed under a different key case', async () => {
    liferay.addProductOptions.mockResolvedValue({
      items: [{ ...linkedColour(liferayValues), key: 'color' }],
    });

    await runToSkus();

    expect(skuOptionsOf()).toEqual([{ optionId: 71565, optionValueId: 71566 }]);
  });

  it('warns at link time when Liferay reports no value relationships', async () => {
    liferay.addProductOptions.mockResolvedValue({
      items: [linkedColour([])],
    });
    liferay.getProductOptions.mockResolvedValue([linkedColour([])]);

    await generator.steps[S.ENSURE_OPTIONS]('sess-1');
    await generator.steps[S.LINK_PRODUCT_OPTIONS]('sess-1');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no option value relationships'),
      expect.objectContaining({ options: ['COLOR'] })
    );
  });

  it('tells a missing link apart from a link missing its values', async () => {
    liferay.addProductOptions.mockResolvedValue({ items: [] });
    liferay.getProductOptions.mockResolvedValue([]);

    await generator.steps[S.ENSURE_OPTIONS]('sess-1');
    await generator.steps[S.LINK_PRODUCT_OPTIONS]('sess-1');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('linked no product option'),
      expect.objectContaining({ options: ['COLOR'] })
    );
  });
});
