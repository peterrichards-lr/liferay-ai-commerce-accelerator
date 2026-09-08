/**
 * The three warehouse strategies, and how they map to the pair of booleans the
 * microservice takes.
 *
 * `createWarehouses` and `reuseExistingWarehouses` have four combinations and
 * only three are coherent. The fourth - create nothing and adopt nothing -
 * leaves a run with no warehouses at all, so inventory is impossible and the
 * run is refused (#732). A pair of checkboxes offers it; a dropdown cannot,
 * which is the point of the change.
 *
 * The strategy is UI state only. What crosses the wire is the two booleans, so
 * the request contract is unchanged and `requestOptionsIntegrity` keeps
 * covering the fields that actually travel.
 */

export const WAREHOUSE_STRATEGIES = {
  // create + reuse. warehouseCount is a target total: asked for five with two
  // already present, three are created and the two are adopted so inventory
  // can be placed in all five. The original default before #692 removed it.
  TOP_UP: 'top-up',

  // create, no reuse. warehouseCount is a number to create: five new beside
  // the two, and only the five belong to this run.
  FRESH_SET: 'fresh-set',

  // no create. The warehouses already there are the run's set, and
  // warehouseCount means nothing.
  EXISTING_ONLY: 'existing-only',
};

export const WAREHOUSE_STRATEGY_OPTIONS = [
  {
    countLabel: 'Total Number of Warehouses',
    description:
      'Create only as many as are needed to reach the total, and use the ones already there alongside them.',
    label: 'Top up to the total below',
    value: WAREHOUSE_STRATEGIES.TOP_UP,
  },
  {
    countLabel: 'Number of Warehouses to Create',
    description:
      'Always create this many. Any warehouses already in the instance are left alone and receive no inventory.',
    label: 'Create a new set, leaving existing ones alone',
    value: WAREHOUSE_STRATEGIES.FRESH_SET,
  },
  {
    countLabel: null,
    description:
      'Create none. Inventory is placed in the warehouses already in the instance, which are also linked to this run’s channels.',
    label: 'Use only the warehouses already there',
    value: WAREHOUSE_STRATEGIES.EXISTING_ONLY,
  },
];

/**
 * Which strategy a saved configuration describes.
 *
 * A stored `createWarehouses: false` maps to "use only what is there"
 * regardless of the reuse flag. That is what it has always meant, and it is
 * also where the incoherent fourth combination lands - reachable in configs
 * saved while both were checkboxes, so it has to resolve to something sensible
 * rather than to an option the dropdown does not offer.
 */
export function strategyFromOptions({
  createWarehouses,
  reuseExistingWarehouses,
} = {}) {
  if (createWarehouses === false) {
    return WAREHOUSE_STRATEGIES.EXISTING_ONLY;
  }

  // Absent means reuse, matching the default the CLI used before #692 removed
  // the flag: `opts.reuseExistingWarehouses !== false`.
  return reuseExistingWarehouses === false
    ? WAREHOUSE_STRATEGIES.FRESH_SET
    : WAREHOUSE_STRATEGIES.TOP_UP;
}

/**
 * The booleans a strategy sends.
 */
export function optionsForStrategy(strategy) {
  switch (strategy) {
    case WAREHOUSE_STRATEGIES.EXISTING_ONLY:
      // Reuse stays true so the pair never expresses the unsupported state,
      // whatever reads it next.
      return { createWarehouses: false, reuseExistingWarehouses: true };

    case WAREHOUSE_STRATEGIES.FRESH_SET:
      return { createWarehouses: true, reuseExistingWarehouses: false };

    case WAREHOUSE_STRATEGIES.TOP_UP:
    default:
      return { createWarehouses: true, reuseExistingWarehouses: true };
  }
}

export function strategyOption(strategy) {
  return (
    WAREHOUSE_STRATEGY_OPTIONS.find((option) => option.value === strategy) ||
    WAREHOUSE_STRATEGY_OPTIONS[0]
  );
}
