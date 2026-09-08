import { describe, expect, it } from 'vitest';
import {
  WAREHOUSE_STRATEGIES,
  WAREHOUSE_STRATEGY_OPTIONS,
  optionsForStrategy,
  strategyFromOptions,
  strategyOption,
} from './warehouseStrategy';

describe('warehouse strategies', () => {
  it('offers three, and never the incoherent fourth', () => {
    // create nothing and adopt nothing leaves a run with no warehouses, so
    // inventory is impossible and the run is refused. A dropdown should not
    // be able to express it at all.
    expect(WAREHOUSE_STRATEGY_OPTIONS).toHaveLength(3);

    const emitted = WAREHOUSE_STRATEGY_OPTIONS.map((option) =>
      optionsForStrategy(option.value)
    );

    expect(
      emitted.some(
        (options) =>
          options.createWarehouses === false &&
          options.reuseExistingWarehouses === false
      )
    ).toBe(false);
  });

  it('gives every option a label and a description', () => {
    WAREHOUSE_STRATEGY_OPTIONS.forEach((option) => {
      expect(option.label).toBeTruthy();
      expect(option.description).toBeTruthy();
    });
  });
});

describe('optionsForStrategy', () => {
  it('maps topping up to create and reuse', () => {
    expect(optionsForStrategy(WAREHOUSE_STRATEGIES.TOP_UP)).toEqual({
      createWarehouses: true,
      reuseExistingWarehouses: true,
    });
  });

  it('maps a fresh set to create without reuse', () => {
    expect(optionsForStrategy(WAREHOUSE_STRATEGIES.FRESH_SET)).toEqual({
      createWarehouses: true,
      reuseExistingWarehouses: false,
    });
  });

  it('maps using only what is there to no creation', () => {
    expect(optionsForStrategy(WAREHOUSE_STRATEGIES.EXISTING_ONLY)).toEqual({
      createWarehouses: false,
      reuseExistingWarehouses: true,
    });
  });

  it('falls back to topping up for anything unrecognised', () => {
    // The non-duplicating choice, and the original default before #692.
    expect(optionsForStrategy(undefined)).toEqual({
      createWarehouses: true,
      reuseExistingWarehouses: true,
    });
  });
});

describe('strategyFromOptions', () => {
  it('reads a saved top-up configuration', () => {
    expect(
      strategyFromOptions({
        createWarehouses: true,
        reuseExistingWarehouses: true,
      })
    ).toBe(WAREHOUSE_STRATEGIES.TOP_UP);
  });

  it('reads a saved fresh-set configuration', () => {
    expect(
      strategyFromOptions({
        createWarehouses: true,
        reuseExistingWarehouses: false,
      })
    ).toBe(WAREHOUSE_STRATEGIES.FRESH_SET);
  });

  it('reads a saved existing-only configuration', () => {
    expect(
      strategyFromOptions({
        createWarehouses: false,
        reuseExistingWarehouses: true,
      })
    ).toBe(WAREHOUSE_STRATEGIES.EXISTING_ONLY);
  });

  it('resolves the incoherent saved pair to using what is there', () => {
    // Reachable in any config saved while both were checkboxes. It has to
    // land on something the dropdown offers, and "no creation" is what
    // createWarehouses: false has always meant.
    expect(
      strategyFromOptions({
        createWarehouses: false,
        reuseExistingWarehouses: false,
      })
    ).toBe(WAREHOUSE_STRATEGIES.EXISTING_ONLY);
  });

  it('treats an absent reuse flag as reuse, matching the pre-#692 default', () => {
    expect(strategyFromOptions({ createWarehouses: true })).toBe(
      WAREHOUSE_STRATEGIES.TOP_UP
    );
  });

  it('treats an empty configuration as topping up', () => {
    expect(strategyFromOptions({})).toBe(WAREHOUSE_STRATEGIES.TOP_UP);
    expect(strategyFromOptions()).toBe(WAREHOUSE_STRATEGIES.TOP_UP);
  });

  it('round-trips every strategy through the booleans', () => {
    Object.values(WAREHOUSE_STRATEGIES).forEach((strategy) => {
      expect(strategyFromOptions(optionsForStrategy(strategy))).toBe(strategy);
    });
  });
});

describe('strategyOption', () => {
  it('labels the count differently per strategy, because it counts different things', () => {
    // A target total when topping up, a number to create otherwise - the
    // reason a dropdown beats two checkboxes.
    expect(strategyOption(WAREHOUSE_STRATEGIES.TOP_UP).countLabel).toMatch(
      /total/i
    );
    expect(strategyOption(WAREHOUSE_STRATEGIES.FRESH_SET).countLabel).toMatch(
      /create/i
    );
  });

  it('has no count at all when no warehouses are being created', () => {
    expect(
      strategyOption(WAREHOUSE_STRATEGIES.EXISTING_ONLY).countLabel
    ).toBeNull();
  });

  it('falls back rather than returning undefined', () => {
    expect(strategyOption('nonsense').value).toBe(WAREHOUSE_STRATEGIES.TOP_UP);
  });
});
