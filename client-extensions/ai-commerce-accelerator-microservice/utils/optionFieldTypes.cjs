const { COMMERCE_CONSTRAINTS } = require('./commerceConstants.cjs');

/**
 * Reconciles an option's field type with its SKU-contributor flag.
 *
 * Liferay validates the pair and rejects it outright. The rule appears twice,
 * once for the global option and once for the product's relationship to it:
 *
 *   CPOptionLocalServiceImpl._validateCommerceOptionTypeKey
 *     -> CPOptionSKUContributorException
 *   the CPDefinitionOptionRel equivalent
 *     -> CPDefinitionOptionSKUContributorException
 *
 * Both replace the configured allow-list with
 * CPConstants.PRODUCT_OPTION_SKU_CONTRIBUTOR_FIELD_TYPES - select, select_date,
 * radio - whenever skuContributor is set. The model is free to ask for text,
 * numeric or checkbox, and does.
 *
 * The second site arrives as a bare 500: Liferay answers
 * `{"status":"INTERNAL_SERVER_ERROR","title":"Internal Server Error"}` with the
 * real exception only in its own log.
 *
 * An option carrying values is a select in all but name, so the type is
 * corrected rather than the intent discarded - dropping skuContributor instead
 * would silently cost the run its SKU variants. An option with no values cannot
 * define a variant at all, so there the flag goes rather than the type.
 */
function reconcileOptionFieldType({
  fieldType,
  skuContributor,
  valueCount = 0,
  allowSkuContribution = true,
}) {
  const requested = String(fieldType || 'select').toLowerCase();

  let type = requested;
  let contributes = Boolean(skuContributor) && allowSkuContribution;

  if (contributes && valueCount === 0) {
    contributes = false;
  } else if (
    contributes &&
    !COMMERCE_CONSTRAINTS.SKU_CONTRIBUTOR_FIELD_TYPES.includes(type)
  ) {
    type = COMMERCE_CONSTRAINTS.DEFAULT_SKU_CONTRIBUTOR_FIELD_TYPE;
  }

  if (!COMMERCE_CONSTRAINTS.VALID_FIELD_TYPES.includes(type)) {
    type = COMMERCE_CONSTRAINTS.DEFAULT_SKU_CONTRIBUTOR_FIELD_TYPE;
  }

  return {
    fieldType: type,
    skuContributor: contributes,
    adjusted: type !== requested || contributes !== Boolean(skuContributor),
  };
}

module.exports = { reconcileOptionFieldType };
