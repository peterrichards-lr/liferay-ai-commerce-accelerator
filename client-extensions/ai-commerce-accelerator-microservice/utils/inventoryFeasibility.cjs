/**
 * Whether a run that asks for inventory can actually deliver any.
 *
 * Inventory entries need a warehouse to sit in. Three combinations are
 * reachable from the form and only two of them work:
 *
 * - `createWarehouses` on - the run makes its own, and inventory lands there.
 * - `createWarehouses` off with warehouses already in the instance - inventory
 *   lands on those. Deliberate and useful; see #664 and #692.
 * - `createWarehouses` off with none present - inventory is impossible, and
 *   until #732 nothing said so. The step returned a bare `BYPASSED`, which
 *   counts as success, so a run reported complete with no stock behind any
 *   product and the operator's inventory settings silently discarded.
 *
 * Refused here rather than at the step, because by the time `update-inventory`
 * runs the products have already been generated and paid for. The same
 * reasoning as #680/#702 for the catalog and channel.
 *
 * And the same rule as those: a refusal needs **positive evidence** that no
 * warehouse exists. A warehouse list that cannot be read proves nothing, so an
 * unreadable list warns and lets the run proceed - a transient API failure
 * must never cost an operator their run.
 */

const WAREHOUSE_PAGE_SIZE = 200;

const FEASIBLE = 'feasible';
const NOT_REQUESTED = 'not-requested';
const RUN_CREATES_WAREHOUSES = 'run-creates-warehouses';
const NO_WAREHOUSE = 'no-warehouse';
const UNCHECKED = 'unchecked';

/**
 * Does this run intend to put stock anywhere?
 *
 * `update-inventory` is not gated by a toggle of its own - it runs whenever a
 * product run does - so intent is read from the options that shape it. A zero
 * assignment ratio means the operator asked for no stock, which is a coherent
 * request and not a problem to refuse.
 */
function runRequestsInventory(options = {}) {
  const productCount = Number(options.productCount);
  const ratio = Number(options.inventoryAssignmentRatio);

  if (!Number.isFinite(productCount) || productCount <= 0) {
    return false;
  }

  // Undefined means "not specified", which the inventory step treats as 100.
  if (options.inventoryAssignmentRatio === undefined) {
    return true;
  }

  return Number.isFinite(ratio) && ratio > 0;
}

/**
 * Will this run have a warehouse of its own by the time inventory runs?
 */
function runCreatesWarehouses(options = {}) {
  if (options.createWarehouses === false) {
    return false;
  }

  const count = Number(options.warehouseCount);

  // Absent count with the toggle on is the pre-#692 default of "yes, some".
  if (options.warehouseCount === undefined) {
    return true;
  }

  return Number.isFinite(count) && count > 0;
}

/**
 * @returns {Promise<{outcome: string, rejection: string|null, log: object}>}
 */
async function assessInventoryFeasibility({
  config,
  options,
  liferayService,
  logger,
} = {}) {
  if (!runRequestsInventory(options)) {
    return {
      outcome: NOT_REQUESTED,
      rejection: null,
      log: { message: 'Inventory was not requested for this run.' },
    };
  }

  if (runCreatesWarehouses(options)) {
    return {
      outcome: RUN_CREATES_WAREHOUSES,
      rejection: null,
      log: {
        message: 'Inventory is feasible: this run creates its own warehouses.',
      },
    };
  }

  let warehouses;

  try {
    const response = await liferayService.getWarehouses(config, {
      pageSize: WAREHOUSE_PAGE_SIZE,
    });

    warehouses = response?.items || (Array.isArray(response) ? response : []);
  } catch (error) {
    // No positive evidence of absence, so the run proceeds. Refusing on an
    // unreadable list would turn a transient API failure into a lost run.
    logger?.warn?.(
      'Could not read the warehouse list, so inventory feasibility is unverified. Proceeding.',
      { message: error?.message }
    );

    return {
      outcome: UNCHECKED,
      rejection: null,
      log: {
        message:
          'Warehouse list could not be read; proceeding without verifying that inventory is possible.',
      },
    };
  }

  if (warehouses.length > 0) {
    return {
      outcome: FEASIBLE,
      rejection: null,
      log: {
        message: `Inventory is feasible: ${warehouses.length} existing warehouse(s) can hold it.`,
      },
    };
  }

  return {
    outcome: NO_WAREHOUSE,
    rejection:
      'This run asks for inventory but no warehouse will exist to hold it. ' +
      'Warehouse creation is switched off and this instance has no warehouses. ' +
      'Turn on Create Warehouses, or set the inventory assignment ratio to 0 if stock is not wanted.',
    log: {
      message:
        'Inventory requested, warehouse creation off, and no warehouse exists in the instance.',
    },
  };
}

module.exports = {
  FEASIBLE,
  NOT_REQUESTED,
  NO_WAREHOUSE,
  RUN_CREATES_WAREHOUSES,
  UNCHECKED,
  assessInventoryFeasibility,
  runCreatesWarehouses,
  runRequestsInventory,
};
