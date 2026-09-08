const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

const WAREHOUSE_ITEM_FIELDS = ['quantity', 'sku', 'warehouseId'];

/**
 * The warehouse items update-inventory builds are a pure function of the run's
 * options and its product list, so what the step can and cannot express is
 * assertable without an instance.
 *
 * These exist because of #695. The form offered an Enable Backorders checkbox
 * and a Backorder Assignment Ratio slider, `utils/normalize.cjs` parsed both
 * into options, and nothing read either one: the payload below is the whole of
 * what a run writes to inventory, and it has no field a backorder setting could
 * occupy. Asserting the exact field set is what stops another option arriving
 * that looks like it works.
 */
describe('update-inventory payloads', () => {
  let generator;
  let liferay;
  let posted;
  let session;

  // The step waits three real seconds for Liferay to index the SKUs before it
  // builds anything. Nothing asserted here depends on that wait, so the timer
  // is faked rather than served.
  const runStep = async () => {
    const running = generator.steps[S.UPDATE_INVENTORY]('sess-1');
    await vi.advanceTimersByTimeAsync(3000);
    return running;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    posted = [];

    liferay = {
      getWarehouses: vi.fn().mockResolvedValue({ items: [{ id: 11 }] }),
      rest: {
        _post: vi.fn(async (_config, path, item) => {
          posted.push({ item, path });
          return {};
        }),
      },
    };

    const persistence = {
      getSession: vi.fn().mockImplementation(async () => session),
      updateSessionContext: vi.fn(),
      createBatch: vi.fn().mockResolvedValue({ id: 'batch-1' }),
      updateBatch: vi.fn().mockResolvedValue({}),
    };

    generator = new ProductGenerator({
      liferay,
      persistence,
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
      },
      progress: { batchStarted: vi.fn(), batchCompleted: vi.fn() },
    });

    generator.completeSyncStep = vi.fn().mockResolvedValue({});
    generator.submitBatch = vi
      .fn()
      .mockImplementation(async (_sessionId, _step, _kind, _op, send) => {
        await send('BATCH-ERC');
      });

    session = {
      session_id: 'sess-1',
      correlationId: 'corr-1',
      context: {
        config: { catalogId: '123' },
        options: {
          inventoryAssignmentRatio: 100,
          inventoryMax: 5,
          inventoryMin: 5,
        },
        productDataList: [
          {
            externalReferenceCode: 'ERC1',
            name: { en_US: 'Trail Runner 500' },
            skus: [{ sku: 'TR500' }],
            skuVariants: [{ sku: 'TR500-BLK' }, { sku: 'TR500-RED' }],
          },
        ],
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // BYPASSED means a live query confirmed there was nothing to do (#699).
  // Stock was asked for here and cannot be delivered, which is a different
  // outcome and must not count towards a successful run (#732).
  it('blocks the step, with a reason, when stock was asked for and no warehouse exists', async () => {
    liferay.getWarehouses.mockResolvedValue({ items: [] });

    await runStep();

    expect(generator.submitBatch).not.toHaveBeenCalled();
    expect(generator.completeSyncStep).toHaveBeenCalledWith(
      'sess-1',
      S.UPDATE_INVENTORY,
      'BLOCKED',
      0,
      0,
      expect.stringContaining('No warehouse exists')
    );
  });

  it('bypasses rather than blocks when no stock was asked for', async () => {
    // Nothing was requested, so nothing missing: a genuine nothing-to-do.
    liferay.getWarehouses.mockResolvedValue({ items: [] });
    session.context.options.inventoryAssignmentRatio = 0;

    await runStep();

    expect(generator.submitBatch).not.toHaveBeenCalled();
    expect(generator.completeSyncStep).toHaveBeenCalledWith(
      'sess-1',
      S.UPDATE_INVENTORY,
      'BYPASSED',
      0,
      0,
      expect.stringContaining('No stock was requested')
    );
  });

  it('bypasses the step when the assignment ratio selects no product', async () => {
    session.context.options.inventoryAssignmentRatio = 0;

    await runStep();

    expect(generator.submitBatch).not.toHaveBeenCalled();
    expect(generator.completeSyncStep).toHaveBeenCalledWith(
      'sess-1',
      S.UPDATE_INVENTORY,
      'BYPASSED'
    );
  });

  it('writes one item per base SKU and per variant of a selected product', async () => {
    await runStep();

    expect(posted.map(({ item }) => item.sku).sort()).toEqual([
      'TR500',
      'TR500-BLK',
      'TR500-RED',
    ]);
  });

  it('sends nothing beyond the SKU, the quantity and the warehouse', async () => {
    await runStep();

    for (const { item } of posted) {
      expect(Object.keys(item).sort()).toEqual(WAREHOUSE_ITEM_FIELDS);
    }
  });

  it('keeps every quantity inside the configured range', async () => {
    session.context.options.inventoryMin = 10;
    session.context.options.inventoryMax = 12;

    await runStep();

    expect(posted).not.toHaveLength(0);
    for (const { item } of posted) {
      expect(item.quantity).toBeGreaterThanOrEqual(10);
      expect(item.quantity).toBeLessThanOrEqual(12);
      expect(Number.isInteger(item.quantity)).toBe(true);
    }
  });

  it('posts each item to the warehouse it names', async () => {
    liferay.getWarehouses.mockResolvedValue({
      items: [{ id: 11 }, { id: 22 }],
    });

    await runStep();

    for (const { item, path } of posted) {
      expect([11, 22]).toContain(item.warehouseId);
      expect(path).toBe(
        `/o/headless-commerce-admin-inventory/v1.0/warehouses/${item.warehouseId}/warehouseItems`
      );
    }
  });

  it('skips a SKU the generation left without a code', async () => {
    session.context.productDataList[0].skus = [{ sku: 'TR500' }, {}];

    await runStep();

    expect(posted.map(({ item }) => item.sku)).not.toContain(undefined);
    expect(posted).toHaveLength(3);
  });
});
