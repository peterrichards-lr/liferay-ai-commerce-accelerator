const WarehouseGenerator = require('../generators/warehouseGenerator.cjs');
const { WORKFLOW_STEPS: S } = require('../utils/constants.cjs');

/**
 * What `warehouseCount` counts, and which warehouses a run may stock.
 *
 * Asked for five with two already in the instance:
 *
 * - reusing:     creates three, total five, and stocks all five
 * - not reusing: creates five, total seven, and stocks only its five
 *
 * The second half of the reuse case matters as much as the count. Topping the
 * count up without adopting the existing two would leave a run reporting five
 * warehouses while stocking three. See #730.
 */
describe('warehouse reuse strategy', () => {
  let generator;
  let liferay;
  let persistence;
  let context;
  let generatedCount;
  let logger;

  const existingWarehouse = (id, city) => ({
    active: true,
    city,
    country: 'DE',
    externalReferenceCode: `AICA-WH-EXISTING-${id}`,
    id,
    name: { en_US: city },
  });

  const setUp = ({ existing = [], options = {} } = {}) => {
    generatedCount = null;

    context = {
      config: { catalogId: 1 },
      options: {
        createWarehouses: true,
        reuseExistingWarehouses: true,
        warehouseCount: 5,
        ...options,
      },
    };

    liferay = {
      getCountries: vi.fn().mockResolvedValue({ items: [] }),
      getWarehouses: vi.fn().mockResolvedValue({ items: existing }),
    };

    persistence = {
      createBatch: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn().mockImplementation(async () => ({
        context,
        correlationId: 'corr-1',
        session_id: 'sess-1',
      })),
      updateSessionContext: vi.fn().mockImplementation(async (_id, patch) => {
        context = { ...context, ...patch };
      }),
    };

    logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn(),
    };

    // liferay, logger and persistence are getters onto ctx on the base class,
    // so they are supplied through the constructor rather than assigned.
    generator = new WarehouseGenerator({
      generation: {
        generateData: vi.fn().mockImplementation(async (_type, count) => {
          generatedCount = count;

          return Array.from({ length: count }, (_unused, index) => ({
            active: true,
            city: `Generated ${index + 1}`,
            country: 'DE',
            name: { en_US: `Generated ${index + 1}` },
          }));
        }),
      },
      liferay,
      logger,
      persistence,
      progress: { batchCompleted: vi.fn(), batchStarted: vi.fn() },
    });

    generator.completeSyncStep = vi.fn().mockResolvedValue(true);
  };

  const runDataStep = () =>
    generator._runWarehouseDataGenerationStep.call(generator, 'sess-1');

  describe('reusing: warehouseCount is a target total', () => {
    it('creates only the shortfall', async () => {
      setUp({
        existing: [
          existingWarehouse(11, 'Hamburg'),
          existingWarehouse(12, 'Munich'),
        ],
      });

      await runDataStep();

      expect(generatedCount).toBe(3);
      expect(context.warehouseDataList).toHaveLength(5);
    });

    it('adopts the existing ones with their ids, so inventory can address them', async () => {
      setUp({
        existing: [
          existingWarehouse(11, 'Hamburg'),
          existingWarehouse(12, 'Munich'),
        ],
      });

      await runDataStep();

      const adopted = context.warehouseDataList.filter((w) => w.id);

      expect(adopted.map((w) => w.id)).toEqual([11, 12]);
    });

    it('generates nothing when the instance already meets the count', async () => {
      setUp({
        existing: [11, 12, 13, 14, 15].map((id) =>
          existingWarehouse(id, `City ${id}`)
        ),
      });

      await runDataStep();

      expect(generatedCount).toBeNull();
      expect(context.warehouseDataList).toHaveLength(5);
    });

    it('does not create a negative number when the instance exceeds the count', async () => {
      setUp({
        existing: [11, 12, 13, 14, 15, 16, 17].map((id) =>
          existingWarehouse(id, `City ${id}`)
        ),
      });

      await runDataStep();

      expect(generatedCount).toBeNull();
      expect(context.warehouseDataList).toHaveLength(7);
    });
  });

  describe('not reusing: warehouseCount is a number to create', () => {
    it('creates the full count and adopts nothing', async () => {
      setUp({
        existing: [
          existingWarehouse(11, 'Hamburg'),
          existingWarehouse(12, 'Munich'),
        ],
        options: { reuseExistingWarehouses: false },
      });

      await runDataStep();

      expect(generatedCount).toBe(5);
      expect(context.warehouseDataList).toHaveLength(5);
      expect(context.warehouseDataList.filter((w) => w.id)).toHaveLength(0);
    });

    it('does not even read the existing warehouses', async () => {
      setUp({ options: { reuseExistingWarehouses: false } });

      await runDataStep();

      expect(liferay.getWarehouses).not.toHaveBeenCalled();
    });
  });

  describe('an unreadable warehouse list', () => {
    it('creates the full count rather than failing the run', async () => {
      // Too many warehouses is untidy; too few means products with no stock.
      setUp();
      liferay.getWarehouses.mockRejectedValue(new Error('ECONNREFUSED'));

      await runDataStep();

      expect(generatedCount).toBe(5);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('the creation step', () => {
    const runCreateStep = () =>
      generator._runWarehouseCreationStep.call(generator, 'sess-1');

    it('does not re-submit an adopted warehouse', async () => {
      // Re-submitting would upsert a warehouse this run did not create, and
      // overwrite whatever an operator had set on it by hand.
      setUp({
        existing: [11, 12, 13, 14, 15].map((id) =>
          existingWarehouse(id, `City ${id}`)
        ),
      });

      await runDataStep();

      generator.submitBatch = vi.fn().mockResolvedValue(true);

      await runCreateStep();

      expect(generator.submitBatch).not.toHaveBeenCalled();
      expect(generator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        S.CREATE_WAREHOUSES,
        'BYPASSED',
        0,
        0,
        expect.stringContaining('already met by 5 existing')
      );
    });

    it('keeps the adopted warehouses in the run set after creating the rest', async () => {
      // Writing only the prepared list would quietly reduce a reuse run to
      // stocking just the warehouses it happened to create.
      setUp({
        existing: [
          existingWarehouse(11, 'Hamburg'),
          existingWarehouse(12, 'Munich'),
        ],
      });

      await runDataStep();

      generator.submitBatch = vi.fn().mockResolvedValue(true);
      generator.liferay.createWarehousesBatch = vi.fn();

      await runCreateStep();

      const ids = context.warehouseDataList
        .map((warehouse) => warehouse.id)
        .filter(Boolean);

      expect(ids).toEqual([11, 12]);
      expect(context.warehouseDataList).toHaveLength(5);
    });
  });
});
