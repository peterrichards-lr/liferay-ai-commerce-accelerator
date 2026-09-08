/**
 * Who decides a warehouse's identity.
 *
 * `prompts/warehouse.md` used to ask the model for the external reference code
 * - "Must start with the prefix AICA-WAREHOUSE- followed by a unique uppercase
 * string (e.g. AICA-WAREHOUSE-HAMBURG)" - and the schema constrained it only
 * to `string`. Three things followed:
 *
 * 1. Identity varied between runs. The ERC was whatever city the model picked,
 *    so a second run at a non-zero temperature produced different codes and
 *    created a second set of warehouses beside the first. When it happened to
 *    pick the same cities the upsert was idempotent - so the behaviour was
 *    *sometimes* right, which is worse than reliably wrong because a single
 *    test will not reveal it. See #730.
 * 2. Nothing could answer "does this warehouse already exist?", which is the
 *    question `reuseExistingWarehouses` and the inventory pre-flight (#732)
 *    both have to answer.
 * 3. The prefix disagreed with `ERC_PREFIX.WAREHOUSE` ('AICA-WH'), which the
 *    code had already declared.
 *
 * `utils/orderErc.cjs` records the precedent: products always generate their
 * own code, and orders keep a supplied one only when it is usable and unique,
 * because re-importing an exported dataset has to preserve identity. It also
 * records the failure mode - the model copying the prompt's example onto every
 * item, which Liferay rejects as a whole batch with a `ConstraintViolation`
 * naming the constraint rather than the duplicate.
 *
 * Warehouses now follow the same rule, with a code we generate.
 *
 * Deliberately *not* derived from the warehouse's location. A code hashed from
 * country and city would make identity stable across runs, which sounds useful
 * and is actively wrong here: whether a warehouse already exists is answered
 * by counting what is in the instance, not by recognising a place. Deriving
 * from location means a newly generated warehouse whose city matches an
 * existing one gets the same code, so the create becomes an upsert and a run
 * asked for five ends up with four - a silent shortfall, which is the defect
 * this file exists to avoid.
 *
 * It must also be unique *across* runs, not merely within one. An index-based
 * code would be deterministic and would make a second run's first warehouse
 * upsert onto the first run's - the same hazard inverted. `createERC` carries
 * a timestamp, a counter and a random suffix, so a new warehouse is always new
 * and `reuseExistingWarehouses` is left to decide whether to make one at all.
 */

const { createERC } = require('./misc.cjs');
const { ERC_PREFIX } = require('./constants.cjs');

const OWN_PREFIX = `${ERC_PREFIX.WAREHOUSE}-`;

/**
 * Whether this code is one of ours, and so safe to preserve.
 *
 * An imported dataset carries the codes a previous run assigned, and keeping
 * them is what lets a re-import land on the same warehouses instead of
 * duplicating them.
 */
function isAssignedWarehouseERC(value) {
  return typeof value === 'string' && value.startsWith(OWN_PREFIX);
}

/**
 * A fresh code for a warehouse we are about to create.
 */
function warehouseERC() {
  return createERC(ERC_PREFIX.WAREHOUSE);
}

/**
 * Gives every warehouse a code we chose, keeping the ones we chose before.
 */
function assignWarehouseERCs(warehouses = [], { logger } = {}) {
  const seen = new Set();
  let replaced = 0;

  const assigned = (Array.isArray(warehouses) ? warehouses : []).map(
    (warehouse) => {
      const supplied = warehouse?.externalReferenceCode;

      if (isAssignedWarehouseERC(supplied) && !seen.has(supplied)) {
        seen.add(supplied);
        return warehouse;
      }

      if (supplied) {
        replaced += 1;
      }

      // Unique by construction, but the guard costs nothing and a duplicate
      // reference code is rejected by Liferay as a whole batch.
      let erc = warehouseERC();

      while (seen.has(erc)) {
        erc = warehouseERC();
      }

      seen.add(erc);

      return { ...warehouse, externalReferenceCode: erc };
    }
  );

  if (replaced > 0) {
    logger?.debug?.(
      `Replaced ${replaced} supplied warehouse reference code(s) with generated codes.`
    );
  }

  return assigned;
}

module.exports = {
  assignWarehouseERCs,
  isAssignedWarehouseERC,
  warehouseERC,
};
