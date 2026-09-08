const {
  FEASIBLE,
  NOT_REQUESTED,
  NO_WAREHOUSE,
  RUN_CREATES_WAREHOUSES,
  UNCHECKED,
  assessInventoryFeasibility,
  runCreatesWarehouses,
  runRequestsInventory,
} = require('../utils/inventoryFeasibility.cjs');

const config = { catalogId: 1, channelId: 2 };

const liferayWith = (warehouses) => ({
  getWarehouses: vi.fn().mockResolvedValue({ items: warehouses }),
});

const liferayThatFails = () => ({
  getWarehouses: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
});

const assess = (options, liferayService, logger = { warn: vi.fn() }) =>
  assessInventoryFeasibility({ config, liferayService, logger, options });

describe('runRequestsInventory', () => {
  it('is false without products, since there is nothing to stock', () => {
    expect(runRequestsInventory({ productCount: 0 })).toBe(false);
    expect(runRequestsInventory({})).toBe(false);
  });

  it('is false when the operator asked for no stock', () => {
    // A zero ratio is a coherent request, not a problem to refuse.
    expect(
      runRequestsInventory({ productCount: 50, inventoryAssignmentRatio: 0 })
    ).toBe(false);
  });

  it('is true when the ratio is absent, which the step reads as everything', () => {
    expect(runRequestsInventory({ productCount: 50 })).toBe(true);
  });

  it('is true for any positive ratio', () => {
    expect(
      runRequestsInventory({ productCount: 50, inventoryAssignmentRatio: 1 })
    ).toBe(true);
  });
});

describe('runCreatesWarehouses', () => {
  it('is false only when the toggle is explicitly off', () => {
    expect(runCreatesWarehouses({ createWarehouses: false })).toBe(false);
    expect(runCreatesWarehouses({ createWarehouses: true })).toBe(true);
    expect(runCreatesWarehouses({})).toBe(true);
  });

  it('is false when the count is zero, whatever the toggle says', () => {
    expect(
      runCreatesWarehouses({ createWarehouses: true, warehouseCount: 0 })
    ).toBe(false);
  });
});

describe('assessInventoryFeasibility', () => {
  it('does not look at the instance when no inventory was asked for', async () => {
    const liferayService = liferayWith([]);
    const result = await assess(
      { productCount: 50, inventoryAssignmentRatio: 0 },
      liferayService
    );

    expect(result.outcome).toBe(NOT_REQUESTED);
    expect(result.rejection).toBeNull();
    expect(liferayService.getWarehouses).not.toHaveBeenCalled();
  });

  it('does not look at the instance when the run makes its own warehouses', async () => {
    const liferayService = liferayWith([]);
    const result = await assess(
      { createWarehouses: true, productCount: 50, warehouseCount: 5 },
      liferayService
    );

    expect(result.outcome).toBe(RUN_CREATES_WAREHOUSES);
    expect(result.rejection).toBeNull();
    expect(liferayService.getWarehouses).not.toHaveBeenCalled();
  });

  it('is feasible when the run creates none but the instance has some', async () => {
    // The #664 / #692 behaviour: inventory lands on what is already there.
    const result = await assess(
      { createWarehouses: false, productCount: 50 },
      liferayWith([{ id: 1 }, { id: 2 }])
    );

    expect(result.outcome).toBe(FEASIBLE);
    expect(result.rejection).toBeNull();
  });

  it('refuses when inventory was asked for and no warehouse will exist', async () => {
    const result = await assess(
      { createWarehouses: false, productCount: 50 },
      liferayWith([])
    );

    expect(result.outcome).toBe(NO_WAREHOUSE);
    expect(result.rejection).toContain('no warehouse will exist');
    // The message has to say what to change, not just what is wrong.
    expect(result.rejection).toContain('Create Warehouses');
    expect(result.rejection).toContain('assignment ratio to 0');
  });

  it('refuses when the toggle is on but the count is zero', async () => {
    const result = await assess(
      { createWarehouses: true, productCount: 50, warehouseCount: 0 },
      liferayWith([])
    );

    expect(result.outcome).toBe(NO_WAREHOUSE);
  });

  // The rule inherited from #702: a refusal needs positive evidence of
  // absence. An unreadable list proves nothing, and turning a transient API
  // failure into a lost run is the worse outcome.
  it('proceeds when the warehouse list cannot be read', async () => {
    const logger = { warn: vi.fn() };
    const result = await assess(
      { createWarehouses: false, productCount: 50 },
      liferayThatFails(),
      logger
    );

    expect(result.outcome).toBe(UNCHECKED);
    expect(result.rejection).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('reads a bare array as well as a paged response', async () => {
    const result = await assess(
      { createWarehouses: false, productCount: 50 },
      { getWarehouses: vi.fn().mockResolvedValue([{ id: 1 }]) }
    );

    expect(result.outcome).toBe(FEASIBLE);
  });
});
