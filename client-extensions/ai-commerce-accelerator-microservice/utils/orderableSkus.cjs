/**
 * Which of a product's SKUs an order may reference.
 *
 * Liferay activates a SKU only when it carries a value for every option the
 * product declares as a SKU contributor. A product with contributing options
 * therefore has orderable *variants* and an unorderable base SKU - and
 * `products.cjs` does not even create the base SKU in that case, so an order
 * naming it references something that does not exist.
 *
 * Orders used to draw from `p.skus` alone, which is exactly that base SKU. On a
 * fifty-product run every product had contributing options, so every order item
 * named a SKU Liferay had never created and `create-orders` failed the whole
 * run with CPDefinitionOptionRelException. The 200 variants that could have
 * been ordered were never considered. See #747.
 *
 * The rule is the product's, not the SKU's: whether variants exist decides
 * which list is orderable, so a product with no contributing options still
 * orders its base SKU, which is the case that worked before.
 */

/**
 * Does this product define an option that makes its SKUs distinct?
 */
function hasSkuContributingOptions(product) {
  const options = product?.productOptions || product?.options || [];

  return options.some((option) => option?.skuContributor === true);
}

/**
 * A SKU is usable in an order if it can be named at all.
 *
 * `purchasable` is deliberately not filtered on here. It is a Liferay flag
 * meaning "may be bought", and the generator sets it true on everything it
 * creates; filtering on it would silently drop SKUs whenever a generator
 * stopped setting it, which is the failure this whole file exists to prevent.
 * A SKU with no code, on the other hand, cannot be referenced at all.
 */
function isNameable(sku) {
  return Boolean(sku?.sku || sku?.externalReferenceCode);
}

/**
 * The SKUs of one product that an order may reference.
 */
function orderableSkusFor(product) {
  const variants = (product?.skuVariants || []).filter(isNameable);

  if (hasSkuContributingOptions(product)) {
    // The base SKU is not created for these products, so variants are the only
    // thing that exists. An empty list is correct rather than a fallback: an
    // order naming the base SKU would fail.
    return variants;
  }

  const base = (product?.skus || []).filter(isNameable);

  // No contributing options, so the base SKU is orderable. Variants are still
  // included where a product happens to have both.
  return [...base, ...variants];
}

/**
 * Every SKU an order may reference, across the run's products.
 */
function orderableSkus(products, { logger } = {}) {
  const list = Array.isArray(products) ? products : [];
  const orderable = list.flatMap((product) => orderableSkusFor(product));

  const withContributing = list.filter(hasSkuContributingOptions).length;
  const strandedBase = list.filter(
    (product) =>
      hasSkuContributingOptions(product) && (product?.skus || []).length > 0
  ).length;

  if (strandedBase > 0) {
    logger?.debug?.(
      `${strandedBase} product(s) have a base SKU that Liferay does not create, because they declare SKU-contributing options; their variants are used instead.`
    );
  }

  logger?.info?.(
    `${orderable.length} orderable SKU(s) across ${list.length} product(s); ${withContributing} product(s) declare SKU-contributing options.`
  );

  return orderable;
}

module.exports = {
  hasSkuContributingOptions,
  orderableSkus,
  orderableSkusFor,
};
