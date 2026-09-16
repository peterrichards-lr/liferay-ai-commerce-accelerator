const OrderGenerator = require('../generators/orderGenerator.cjs');
const AccountGenerator = require('../generators/accountGenerator.cjs');
const WarehouseGenerator = require('../generators/warehouseGenerator.cjs');
const { WORKFLOW_STEPS: S } = require('../utils/constants.cjs');

// A generation step that reports the delivered count as both the processed
// count and the total records "38 of 38" for a run that asked for 50. The
// shortfall is then not merely unreported, it is unrepresentable - and the run
// reads as a complete success. Products recorded this honestly; orders,
// accounts and warehouses did not (#955).
//
// These go through the real step rather than the helper, because the defect
// being guarded against is a miswired argument - a helper called with
// `delivered` in the `requested` position passes any test of the helper alone.

const makeLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
});

const makePersistence = (context) => ({
  getSession: vi.fn().mockResolvedValue({
    session_id: 'sess-1',
    correlationId: 'corr-1',
    context,
  }),
  updateSessionContext: vi.fn().mockResolvedValue({}),
  createBatch: vi.fn().mockResolvedValue({}),
});

const rows = (n, prefix) =>
  Array.from({ length: n }, (_unused, i) => ({
    externalReferenceCode: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
  }));

describe('generation steps record the requested count, not the delivered one (#955)', () => {
  describe('orders', () => {
    const run = async (delivered, orderCount) => {
      const logger = makeLogger();
      const generator = new OrderGenerator({
        persistence: makePersistence({
          config: { channelId: '1' },
          options: { orderCount },
        }),
        logger,
        progress: { batchStarted: vi.fn(), batchCompleted: vi.fn() },
        generation: {
          generateData: vi.fn().mockResolvedValue(rows(delivered, 'ORD')),
        },
        liferay: {},
      });

      generator.validateConfig = vi.fn();
      generator.validateOptions = vi.fn().mockResolvedValue({});
      generator.getProductsAndAccounts = vi
        .fn()
        .mockResolvedValue({ products: [{ id: 1 }], accounts: [{ id: 2 }] });
      generator.completeSyncStep = vi.fn().mockResolvedValue({});

      await generator.steps[S.GENERATE_ORDER_DATA]('sess-1');

      return { generator, logger };
    };

    it('names the shortfall on the step when the AI delivers fewer', async () => {
      const { generator, logger } = await run(38, 50);

      expect(generator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        S.GENERATE_ORDER_DATA,
        'SYNCHRONOUS',
        38,
        50,
        expect.stringContaining('returned 38 of 50 requested orders')
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('fell short'),
        expect.anything()
      );
    });

    it('says nothing extra when the AI delivered what was asked', async () => {
      const { generator, logger } = await run(50, 50);

      expect(generator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        S.GENERATE_ORDER_DATA,
        'SYNCHRONOUS',
        50,
        50
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('accounts', () => {
    const run = async (delivered, accountCount) => {
      const logger = makeLogger();
      const generator = new AccountGenerator({
        persistence: makePersistence({
          config: { channelId: '1' },
          options: { accountCount },
        }),
        logger,
        progress: { batchStarted: vi.fn(), batchCompleted: vi.fn() },
        generation: {
          generateData: vi.fn().mockResolvedValue(rows(delivered, 'ACC')),
        },
        liferay: { getCountries: vi.fn().mockResolvedValue([]) },
      });

      generator.validateConfig = vi.fn();
      generator.validateOptions = vi.fn().mockResolvedValue({});
      generator.completeSyncStep = vi.fn().mockResolvedValue({});

      await generator.steps[S.GENERATE_ACCOUNT_DATA]('sess-1');

      return { generator, logger };
    };

    it('names the shortfall on the step when the AI delivers fewer', async () => {
      const { generator, logger } = await run(38, 50);

      expect(generator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        S.GENERATE_ACCOUNT_DATA,
        'SYNCHRONOUS',
        38,
        50,
        expect.stringContaining('returned 38 of 50 requested accounts')
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('fell short'),
        expect.anything()
      );
    });

    it('says nothing extra when the AI delivered what was asked', async () => {
      const { generator, logger } = await run(50, 50);

      expect(generator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        S.GENERATE_ACCOUNT_DATA,
        'SYNCHRONOUS',
        50,
        50
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('warehouses', () => {
    // `warehouseCount` is a target total when reusing and a number to create
    // when not (#730), so the denominator has to be adopted + still-to-create
    // rather than the raw option either way.
    const run = async (delivered, warehouseCount, adoptedCount = 0) => {
      const logger = makeLogger();
      const generator = new WarehouseGenerator({
        persistence: makePersistence({
          config: { channelId: '1' },
          options: {
            warehouseCount,
            reuseExistingWarehouses: adoptedCount > 0,
          },
        }),
        logger,
        progress: { batchStarted: vi.fn(), batchCompleted: vi.fn() },
        generation: {
          generateData: vi.fn().mockResolvedValue(rows(delivered, 'WH')),
        },
        liferay: { getCountries: vi.fn().mockResolvedValue([]) },
      });

      generator.validateConfig = vi.fn();
      generator.validateOptions = vi.fn().mockResolvedValue({});
      generator._readExistingWarehouses = vi
        .fn()
        .mockResolvedValue(rows(adoptedCount, 'EXISTING'));
      generator.completeSyncStep = vi.fn().mockResolvedValue({});

      await generator.steps[S.GENERATE_WAREHOUSE_DATA]('sess-1');

      return { generator, logger };
    };

    it('names the shortfall on the step when the AI delivers fewer', async () => {
      const { generator, logger } = await run(3, 5);

      expect(generator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        S.GENERATE_WAREHOUSE_DATA,
        'SYNCHRONOUS',
        3,
        5,
        expect.stringContaining('returned 3 of 5 requested warehouses')
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('fell short'),
        expect.anything()
      );
    });

    it('counts adopted warehouses towards the target when reusing', async () => {
      // Two adopted, three asked of the model, three delivered: the run reached
      // the target of five and has not fallen short.
      const { generator, logger } = await run(3, 5, 2);

      expect(generator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        S.GENERATE_WAREHOUSE_DATA,
        'SYNCHRONOUS',
        5,
        5
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('says nothing extra when the AI delivered what was asked', async () => {
      const { generator, logger } = await run(5, 5);

      expect(generator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        S.GENERATE_WAREHOUSE_DATA,
        'SYNCHRONOUS',
        5,
        5
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
