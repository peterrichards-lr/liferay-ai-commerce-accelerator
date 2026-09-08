/**
 * Which products accept backorders, and how much stock they carry.
 *
 * `enableBackorders` and `backorderAssignmentRatio` were parsed and never
 * read, so the checkbox and the slider had no effect on a run (#695). They
 * were removed as dead in #715; that was the wrong call - an option nobody
 * implemented is a missing feature, not dead weight.
 *
 * Two decisions, made once and used twice, which is the whole reason this
 * lives in one place:
 *
 * 1. Which products carry `allowBackOrder`. The product step sends it.
 * 2. How much stock those products get. The inventory step caps it, because a
 *    backorder-enabled product holding a thousand units never demonstrates a
 *    backorder - the flag would be set correctly and nothing observable would
 *    follow from it.
 *
 * The share is marked on the product data itself rather than recomputed in
 * each step. Recomputing would agree only while the rule, the list and the
 * ratio stayed identical in two places, and the moment they drifted the wrong
 * products would get the low stock with nothing in the data to show it.
 */

const { SELECTION_KEYS, selectShare } = require('./shareSelection.cjs');

/**
 * Stock for a backorder-enabled product, low enough that running out is the
 * expected state rather than a surprise.
 */
const BACKORDER_INVENTORY_CEILING = 5;

/**
 * Does this run want backorders at all?
 *
 * The toggle is the switch and the ratio is the share, matching how
 * `imageMode` gates `imageRatio` (#736). An explicit ratio of 0 means none
 * even with the toggle on, because "no backorders" is a coherent request.
 */
function backorderRatio(options = {}) {
  if (options.enableBackorders === false) {
    return 0;
  }

  const ratio = Number(options.backorderAssignmentRatio);

  // Absent with the toggle on means none rather than everything: unlike a
  // media mode, the toggle carries no separate intent, so there is nothing to
  // infer a share from. A saved config that sets the toggle and not the ratio
  // is asking for a feature it has not configured.
  return Number.isFinite(ratio) ? ratio : 0;
}

/**
 * Marks the products that accept backorders.
 *
 * Keyed on SELECTION_KEYS.BACKORDER, so the share is independent of the image,
 * PDF and inventory shares - the same products must not end up carrying every
 * attribute while the rest of the catalogue sits inert.
 */
function markBackorderShare(productDataList, options = {}, { logger } = {}) {
  const products = Array.isArray(productDataList) ? productDataList : [];
  const ratio = backorderRatio(options);

  if (products.length === 0) {
    return products;
  }

  const selected = new Set(
    selectShare(products, ratio, SELECTION_KEYS.BACKORDER, { logger })
      .map((product) => product.externalReferenceCode)
      .filter(Boolean)
  );

  const marked = products.map((product) => ({
    ...product,
    // A product with no reference code stays out of the share rather than
    // silently in it; selectShare warns about the same case, so the cause is
    // already reported.
    allowBackOrder: product?.externalReferenceCode
      ? selected.has(product.externalReferenceCode)
      : false,
  }));

  const count = marked.filter((product) => product.allowBackOrder).length;

  logger?.info?.(
    `Backorders enabled on ${count} of ${marked.length} products (${ratio}%).`
  );

  return marked;
}

/**
 * The stock a product should carry, given whether it accepts backorders.
 *
 * A backorder product is capped, and the *first* of them is put at zero so the
 * state is always demonstrable rather than dependent on a random draw. Which
 * product that is follows the list order, so it is as reproducible as the
 * share itself.
 */
function inventoryBoundsFor(product, options = {}, { isFirstBackorder } = {}) {
  const min = Number(options.inventoryMin);
  const max = Number(options.inventoryMax);

  const floor = Number.isFinite(min) ? min : 10;
  const ceiling = Number.isFinite(max) ? max : 100;

  if (!product?.allowBackOrder) {
    return { max: ceiling, min: floor };
  }

  if (isFirstBackorder) {
    return { max: 0, min: 0 };
  }

  return {
    max: Math.min(ceiling, BACKORDER_INVENTORY_CEILING),
    min: Math.min(floor, BACKORDER_INVENTORY_CEILING),
  };
}

module.exports = {
  BACKORDER_INVENTORY_CEILING,
  backorderRatio,
  inventoryBoundsFor,
  markBackorderShare,
};
