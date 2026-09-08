/**
 * The parts of the product subflow an operator can switch off.
 *
 * The step list is a pure function of the options, and it is built in more than
 * one place - the HTTP generate route and the MCP tool. Composing the optional
 * parts here is what stops a toggle being honoured in one and ignored in the
 * other, which is how `createWarehouses` and `generateSpecifications` came to
 * gate nothing at all and `generatePriceLists` beside them came to gate the
 * wrong step. See #647 and #694.
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

/**
 * The steps that write this run's prices, plus the one that keeps the catalog
 * pointing at the list Liferay files them into.
 *
 * `generatePriceLists` used to gate `update-catalog-config` alone, leaving
 * `create-price-lists` and the bulk and tier steps nested under it in the form
 * writing price entries whatever the operator asked for (#694).
 *
 * Honouring the flag does not leave the catalogue unpriced. Liferay files
 * `Sku.price` and `Sku.promoPrice` into the lists carrying
 * `catalogBasePriceList` on every product and SKU write - `SkuUtil`'s
 * `updateCommercePriceEntries`, called unconditionally by `ProductResourceImpl`
 * and `SkuResourceImpl` - and `create-product-skus` sends a price on every SKU.
 * The AICA lists were only ever a second copy of that.
 *
 * `update-catalog-config` stays outside the gate deliberately. Since #703 it is
 * a no-op once the catalog's own list already holds the flag, and when an
 * earlier run left the flag on an AICA list it is the only step that puts it
 * back - which is what keeps `Sku.price` landing in a list the catalogue reads.
 */
function pricingSteps(options = {}) {
  const steps = [];

  if (options.generatePriceLists) {
    steps.push({ name: S.GENERATE_PRICE_LISTS, type: 'sync' });
  }

  steps.push({ name: S.UPDATE_CATALOG_CONFIG, type: 'sync' });

  if (options.generatePriceLists && options.generateBulkPricing) {
    steps.push({ name: S.GENERATE_BULK_PRICING, type: 'sync' });
  }

  if (options.generatePriceLists && options.generateTierPricing) {
    steps.push({ name: S.GENERATE_TIER_PRICING, type: 'sync' });
  }

  return steps;
}

module.exports = {
  pricingSteps,
  specificationSteps,
  warehouseCreationSteps,
};
