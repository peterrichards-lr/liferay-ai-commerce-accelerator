/**
 * The parts of the product subflow an operator can switch off.
 *
 * The step list is a pure function of the options, and it is built in more than
 * one place - the HTTP generate route and the MCP tool. Composing the optional
 * parts here is what stops a toggle being honoured in one and ignored in the
 * other, which is how `createWarehouses` and `generateSpecifications` came to
 * gate nothing at all while `generatePriceLists` beside them did. See #647.
 */
const { WORKFLOW_STEPS } = require('./constants.cjs');

const S = WORKFLOW_STEPS;

/**
 * The steps that bring this run's own warehouses into existence.
 *
 * Deliberately excludes link-warehouse-channels, which is not creation: it
 * falls back to the warehouses that already exist when this run created none,
 * so a channel that would otherwise show no availability for its products still
 * gets one. Leaving it out of the gate is what makes "create warehouses"
 * unchecked mean "use the warehouses already there" rather than "have none".
 */
function warehouseCreationSteps(options = {}) {
  if (!options.createWarehouses || !(options.warehouseCount > 0)) {
    return [];
  }

  return [
    { name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' },
    { name: S.CREATE_WAREHOUSES, type: 'sync' },
    { name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' },
  ];
}

/**
 * The steps that register the specifications generated products carry.
 *
 * Paired with the specifications being dropped from the generated data itself
 * (see product-steps/generation.cjs): a product may only be sent with
 * specification values whose definitions this run ensured exist, because
 * Liferay resolves them by key at product creation and has nothing to resolve
 * against otherwise.
 */
function specificationSteps(options = {}) {
  if (!options.generateSpecifications) {
    return [];
  }

  return [
    { name: S.ENSURE_SPECIFICATION_CATEGORIES, type: 'sync' },
    { name: S.ENSURE_SPECIFICATIONS, type: 'sync' },
  ];
}

module.exports = {
  specificationSteps,
  warehouseCreationSteps,
};
