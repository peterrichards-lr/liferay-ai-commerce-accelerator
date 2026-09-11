const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const {
  summariseFailures,
  writeEachEntity,
} = require('../utils/entityWrites.cjs');

const rejection = (status, title) => {
  const error = new Error('Failed to create price entry');

  error.name = 'LiferayRequestError';
  error.operation = 'create-price-entry';
  error.status = status;
  error.response = { status, data: { status, title } };
  error.problem = { status, title };

  return error;
};

describe('writeEachEntity', () => {
  it('records a rejected entity and writes the rest', async () => {
    const { failures, written } = await writeEachEntity({
      describe: (entity) => entity.sku,
      entities: [{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }],
      write: (entity) => {
        if (entity.sku === 'B') throw rejection(400, 'price is not a Double');
        return Promise.resolve();
      },
    });

    expect(written).toBe(2);
    expect(failures).toEqual([
      { reason: 'HTTP 400: price is not a Double', subject: 'B' },
    ]);
  });

  it('names the entity and the status rather than the operation label', async () => {
    // "Failed to create price entry" is the friendly name of the call, which
    // is the one fact the reader already had (#890).
    const { failures } = await writeEachEntity({
      describe: (entity) => entity.sku,
      entities: [{ sku: 'LINER-WP-L-SMALL' }],
      write: () => Promise.reject(rejection(400, 'price is not a Double')),
    });

    expect(summariseFailures(failures)).toBe(
      'LINER-WP-L-SMALL (HTTP 400: price is not a Double)'
    );
  });

  it('stops on a rejected credential instead of asking fifty more times', async () => {
    // One authentication failure against production produced 51 requests.
    // Credentials do not become valid on the fifty-first attempt (#890).
    const write = vi.fn().mockRejectedValue(rejection(401, 'Unauthorized'));

    await expect(
      writeEachEntity({
        concurrency: 1,
        entities: Array.from({ length: 52 }, (_, index) => index),
        write,
      })
    ).rejects.toMatchObject({ status: 401 });

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('stops on a 403 as well, which is the same answer twice', async () => {
    const write = vi.fn().mockRejectedValue(rejection(403, 'Forbidden'));

    await expect(
      writeEachEntity({ concurrency: 1, entities: [1, 2, 3], write })
    ).rejects.toMatchObject({ status: 403 });

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('caps how many failures it names and says how many it did not', async () => {
    const failures = Array.from({ length: 8 }, (_, index) => ({
      reason: 'HTTP 400',
      subject: `SKU-${index}`,
    }));

    expect(summariseFailures(failures)).toContain('and 3 more');
  });
});

// A promotion to production wrote 22 products, lost one price entry of 52, and
// skipped the 22 images and 22 PDFs that were the point of the exercise. The
// media is why the feature exists: AI generation is not deterministic, so the
// half the run delivered is the half that could have been regenerated (#892).
describe('the pricing step survives one rejected price entry', () => {
  const CATALOG_ID = '123';

  let productGenerator;
  let mockLiferay;
  let mockProgress;

  const skus = ['SKU1', 'SKU2', 'SKU3'];

  const productWithPrices = () => ({
    externalReferenceCode: 'ERC1',
    id: 'p-1',
    name: { en_US: 'Product 1' },
    priceEntries: skus.map((sku) => ({
      price: 99.99,
      skuExternalReferenceCode: sku,
    })),
    skus: skus.map((sku) => ({ externalReferenceCode: sku, id: `id-${sku}` })),
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockLiferay = {
      createPriceEntry: vi.fn().mockResolvedValue({ id: 'pe-1' }),
      createPriceList: vi
        .fn()
        .mockImplementation((_config, data) =>
          Promise.resolve({ ...data, id: `created-${data.type}` })
        ),
      getPriceEntries: vi.fn().mockResolvedValue({ items: [] }),
      getPriceListByERC: vi.fn().mockResolvedValue(null),
      getPriceLists: vi.fn().mockResolvedValue({
        items: [
          {
            catalogBasePriceList: true,
            catalogId: CATALOG_ID,
            externalReferenceCode: null,
            id: 'base-pl',
            name: 'Master Base Price List',
            type: 'price-list',
          },
        ],
      }),
      patchPriceList: vi.fn().mockResolvedValue({}),
      rest: { _delete: vi.fn().mockResolvedValue({}) },
    };

    mockProgress = {
      batchCompleted: vi.fn(),
      batchStarted: vi.fn(),
      stepWarning: vi.fn(),
    };

    productGenerator = new ProductGenerator({
      liferay: mockLiferay,
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
      persistence: {
        createBatch: vi.fn().mockResolvedValue({}),
        getSession: vi.fn(),
        updateBatch: vi.fn().mockResolvedValue({}),
      },
      progress: mockProgress,
    });

    productGenerator.completeSyncStep = vi.fn().mockResolvedValue({});
    productGenerator.submitBatch = vi
      .fn()
      .mockImplementation(async (_s, _k, _e, _o, fn) => {
        await fn('batch-erc');
        return { batchERC: 'batch-erc', batchId: 'b-1' };
      });

    productGenerator.persistence.getSession.mockResolvedValue({
      correlationId: 'corr-1',
      session_id: 'sess-1',
      context: {
        config: { catalogId: CATALOG_ID, currencyCode: 'USD' },
        options: { generatePriceLists: true },
        productDataList: [productWithPrices()],
      },
    });
  });

  const rejectOne = (sku) =>
    mockLiferay.createPriceEntry.mockImplementation((_config, _key, entry) =>
      entry.skuExternalReferenceCode === sku
        ? Promise.reject(rejection(400, 'price is not a Double'))
        : Promise.resolve({ id: 'pe-1' })
    );

  const runPricing = () =>
    productGenerator.steps[WORKFLOW_STEPS.GENERATE_PRICE_LISTS]('sess-1');

  it('does not abandon the run over one entity', async () => {
    rejectOne('SKU2');

    await expect(runPricing()).resolves.not.toThrow();
  });

  it('still writes every other price entry', async () => {
    rejectOne('SKU2');

    await runPricing();

    const attempted = mockLiferay.createPriceEntry.mock.calls.map(
      ([, , entry]) => entry.skuExternalReferenceCode
    );

    expect(attempted).toEqual(expect.arrayContaining(skus));
  });

  it('names the SKU and the reason rather than leaving it to the logs', async () => {
    rejectOne('SKU2');

    await runPricing();

    expect(mockProgress.stepWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'priceLists',
        message: expect.stringContaining(
          'SKU2 (HTTP 400: price is not a Double)'
        ),
      })
    );
  });

  it('records what it wrote, not what it was handed', async () => {
    rejectOne('SKU2');

    await runPricing();

    expect(productGenerator.persistence.updateBatch).toHaveBeenCalledWith(
      'batch-erc',
      { errorCount: 1, processedCount: 2 }
    );
  });

  it('says nothing when every entry was written', async () => {
    await runPricing();

    expect(mockProgress.stepWarning).not.toHaveBeenCalled();
  });

  it('still stops the run when the credentials are refused', async () => {
    // A rejected entity is a defect in that entity; a rejected credential
    // condemns every step that follows.
    mockLiferay.createPriceEntry.mockRejectedValue(
      rejection(401, 'Unauthorized')
    );

    await expect(runPricing()).rejects.toMatchObject({ status: 401 });
  });
});
