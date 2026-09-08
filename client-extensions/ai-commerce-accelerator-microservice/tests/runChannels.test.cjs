const ProductGenerator = require('../generators/productGenerator.cjs');
const WarehouseGenerator = require('../generators/warehouseGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const {
  channelBackfillSteps,
  resolveRunChannelIds,
} = require('../utils/runChannels.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');

function buildCtx() {
  return {
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    },
    persistence: {
      getSession: vi.fn(),
      updateSessionContext: vi.fn(),
      createBatch: vi.fn().mockResolvedValue({ id: 'batch-1' }),
      updateBatch: vi.fn().mockResolvedValue({}),
    },
    liferay: {
      createProductsBatch: vi.fn().mockResolvedValue({ batchId: 'batch-p1' }),
      createWarehouseChannel: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      getProducts: vi.fn().mockResolvedValue({ items: [] }),
      getWarehouses: vi.fn().mockResolvedValue({ items: [] }),
      rest: {
        _get: vi.fn().mockResolvedValue({ items: [] }),
        _patch: vi.fn().mockResolvedValue({}),
      },
    },
    progress: {
      batchStarted: vi.fn(),
      batchCompleted: vi.fn(),
    },
  };
}

function stubSyncSteps(generator) {
  generator.completeSyncStep = vi
    .fn()
    .mockResolvedValue({ status: 'COMPLETED' });
  generator.submitBatch = vi.fn(async (_sessionId, _step, _entity, _op, fn) =>
    fn('batch-erc')
  );
  return generator;
}

describe('resolveRunChannelIds', () => {
  it('keeps a single-channel run to the one channel it named', () => {
    expect(resolveRunChannelIds({ channelId: 42 })).toEqual([42]);
    expect(resolveRunChannelIds({ channelId: '42' })).toEqual([42]);
  });

  it('puts the primary channel first and drops duplicates and junk', () => {
    expect(
      resolveRunChannelIds({
        channelId: 42,
        channelIds: [77, 42, '88', null, 'nope'],
      })
    ).toEqual([42, 77, 88]);
  });

  it('returns nothing when no channel is identifiable', () => {
    expect(resolveRunChannelIds({})).toEqual([]);
    expect(resolveRunChannelIds({ channelId: 'B2B' })).toEqual([]);
  });
});

describe('channelBackfillSteps', () => {
  it('backfills channels for a run that orders without generating products', () => {
    expect(channelBackfillSteps({ orderCount: 5, productCount: 0 })).toEqual([
      { name: WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS, type: 'sync' },
      { name: WORKFLOW_STEPS.LINK_WAREHOUSE_CHANNELS, type: 'sync' },
    ]);
  });

  it('adds nothing to a run that creates its own products', () => {
    expect(channelBackfillSteps({ orderCount: 5, productCount: 3 })).toEqual(
      []
    );
  });

  it('adds nothing to a run that places no orders', () => {
    expect(channelBackfillSteps({ orderCount: 0, productCount: 0 })).toEqual(
      []
    );
    expect(channelBackfillSteps({})).toEqual([]);
  });
});

describe('buildConfigAndOptions channelIds', () => {
  const build = (body) =>
    buildConfigAndOptions({
      headers: {},
      body: {
        liferayUrl: 'http://test.com',
        clientId: 'test',
        clientSecret: 'test',
        ...body,
      },
    });

  it('leaves channelIds undefined when the request never mentions it', () => {
    const { config } = build({ channelId: '31130' });

    expect(config.channelId).toBe(31130);
    expect(config.channelIds).toBeUndefined();
  });

  it.each([
    ['an array', ['31130', 40000]],
    ['a JSON array', '[31130, 40000]'],
    ['a comma-separated string', '31130,40000'],
  ])('accepts %s of channel ids', (_label, channelIds) => {
    const { config } = build({ channelId: '31130', channelIds });

    expect(config.channelIds).toEqual([31130, 40000]);
  });
});

describe('create-products channel association', () => {
  let ctx;
  let generator;
  let session;

  beforeEach(() => {
    ctx = buildCtx();
    generator = stubSyncSteps(new ProductGenerator(ctx));
    session = {
      session_id: 'sess-1',
      context: {
        config: { catalogId: '99', channelId: '31130', batchSize: 10 },
        options: {},
        productDataList: [
          { externalReferenceCode: 'ERC1', name: 'One', description: 'd' },
        ],
      },
    };
    ctx.persistence.getSession.mockResolvedValue(session);
  });

  it('sends only the primary channel for a single-channel run', async () => {
    await generator.steps[WORKFLOW_STEPS.CREATE_PRODUCTS]('sess-1');

    const [, chunk] = ctx.liferay.createProductsBatch.mock.calls[0];
    expect(chunk[0].productChannels).toEqual([{ channelId: 31130 }]);
  });

  it('sends every channel the run named', async () => {
    session.context.config.channelIds = [31130, 40000];

    await generator.steps[WORKFLOW_STEPS.CREATE_PRODUCTS]('sess-1');

    const [, chunk] = ctx.liferay.createProductsBatch.mock.calls[0];
    expect(chunk[0].productChannels).toEqual([
      { channelId: 31130 },
      { channelId: 40000 },
    ]);
  });
});

describe('link-product-channels', () => {
  let ctx;
  let generator;
  let session;

  beforeEach(() => {
    ctx = buildCtx();
    generator = stubSyncSteps(new ProductGenerator(ctx));
    session = {
      session_id: 'sess-1',
      context: {
        config: { catalogId: '99', channelId: 40000 },
        options: {},
        productDataList: [],
      },
    };
    ctx.persistence.getSession.mockResolvedValue(session);
  });

  it('reaches for the products already in the catalog when the run made none', async () => {
    ctx.liferay.getProducts.mockResolvedValue({
      items: [
        { externalReferenceCode: 'ERC1' },
        { externalReferenceCode: 'ERC2' },
      ],
    });

    await generator.steps[WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS]('sess-1');

    expect(ctx.liferay.getProducts).toHaveBeenCalledWith(
      session.context.config,
      expect.objectContaining({ catalogId: '99' })
    );
    expect(ctx.liferay.rest._patch).toHaveBeenCalledTimes(2);
  });

  it('patches the union so an earlier run channel is never dropped', async () => {
    session.context.productDataList = [{ externalReferenceCode: 'ERC1' }];
    ctx.liferay.rest._get.mockResolvedValue({
      items: [{ channelId: 31130 }],
    });

    await generator.steps[WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS]('sess-1');

    const [, path, payload] = ctx.liferay.rest._patch.mock.calls[0];
    expect(path).toContain('by-externalReferenceCode/ERC1');
    expect(payload).toEqual({
      productChannels: [{ channelId: 31130 }, { channelId: 40000 }],
    });
  });

  it('does not patch a product that already serves the channel', async () => {
    session.context.productDataList = [{ externalReferenceCode: 'ERC1' }];
    ctx.liferay.rest._get.mockResolvedValue({
      items: [{ channelId: 40000 }],
    });

    await generator.steps[WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS]('sess-1');

    expect(ctx.liferay.rest._patch).not.toHaveBeenCalled();
    expect(generator.completeSyncStep).toHaveBeenCalledWith(
      'sess-1',
      WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS,
      'SYNCHRONOUS',
      1,
      1
    );
  });

  it('bypasses when the catalog holds nothing to link', async () => {
    await generator.steps[WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS]('sess-1');

    expect(generator.completeSyncStep).toHaveBeenCalledWith(
      'sess-1',
      WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS,
      'BYPASSED'
    );
  });

  it('bypasses when the run names no channel', async () => {
    session.context.config.channelId = undefined;

    await generator.steps[WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS]('sess-1');

    expect(ctx.liferay.getProducts).not.toHaveBeenCalled();
    expect(generator.completeSyncStep).toHaveBeenCalledWith(
      'sess-1',
      WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS,
      'BYPASSED'
    );
  });

  it('records a failed batch and rethrows when Liferay rejects the patch', async () => {
    session.context.productDataList = [{ externalReferenceCode: 'ERC1' }];
    ctx.liferay.rest._patch.mockRejectedValue(new Error('patch refused'));

    await expect(
      generator.steps[WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS]('sess-1')
    ).rejects.toThrow('patch refused');
    expect(ctx.persistence.createBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        stepKey: WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS,
        status: 'FAILED',
      })
    );
  });
});

describe('link-warehouse-channels', () => {
  let ctx;
  let generator;
  let session;

  beforeEach(() => {
    ctx = buildCtx();
    generator = stubSyncSteps(new WarehouseGenerator(ctx));
    session = {
      session_id: 'sess-1',
      context: {
        config: { channelId: 31130 },
        options: {},
        warehouseDataList: [{ id: 2001 }, { id: 2002 }],
      },
    };
    ctx.persistence.getSession.mockResolvedValue(session);
  });

  it('links each warehouse to the one channel of a single-channel run', async () => {
    await generator.steps[WORKFLOW_STEPS.LINK_WAREHOUSE_CHANNELS]('sess-1');

    expect(ctx.liferay.createWarehouseChannel.mock.calls).toEqual([
      [session.context.config, 2001, 31130],
      [session.context.config, 2002, 31130],
    ]);
  });

  it('links each warehouse to every channel the run named', async () => {
    session.context.config.channelIds = [31130, 40000];

    await generator.steps[WORKFLOW_STEPS.LINK_WAREHOUSE_CHANNELS]('sess-1');

    expect(ctx.liferay.createWarehouseChannel).toHaveBeenCalledTimes(4);
    expect(ctx.liferay.createWarehouseChannel).toHaveBeenCalledWith(
      session.context.config,
      2002,
      40000
    );
  });

  it('reaches for existing warehouses when the run created none', async () => {
    session.context.warehouseDataList = [];
    ctx.liferay.getWarehouses.mockResolvedValue({ items: [{ id: 3001 }] });

    await generator.steps[WORKFLOW_STEPS.LINK_WAREHOUSE_CHANNELS]('sess-1');

    expect(ctx.liferay.createWarehouseChannel).toHaveBeenCalledWith(
      session.context.config,
      3001,
      31130
    );
  });

  it('bypasses without throwing when the run has no warehouse list at all', async () => {
    delete session.context.warehouseDataList;

    await generator.steps[WORKFLOW_STEPS.LINK_WAREHOUSE_CHANNELS]('sess-1');

    expect(generator.completeSyncStep).toHaveBeenCalledWith(
      'sess-1',
      WORKFLOW_STEPS.LINK_WAREHOUSE_CHANNELS,
      'BYPASSED'
    );
  });
});
