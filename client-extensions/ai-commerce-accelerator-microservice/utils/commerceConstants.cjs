/**
 * Liferay Commerce Constants and Constraints
 */

const COMMERCE_CONSTRAINTS = Object.freeze({
  // Field types Liferay allows for an option that contributes to SKUs.
  //
  // Taken from CPConstants.PRODUCT_OPTION_SKU_CONTRIBUTOR_FIELD_TYPES:
  //
  //   { "select", "select_date", "radio" }
  //
  // CPOptionLocalServiceImpl._validateCommerceOptionTypeKey replaces the
  // configured allow-list with this one whenever skuContributor is set, and
  // throws CPOptionSKUContributorException for anything outside it. This list
  // previously also contained 'checkbox' and 'checkbox_multiple', which
  // Liferay rejects, and nothing checked the field type against it anyway.
  SKU_CONTRIBUTOR_FIELD_TYPES: ['radio', 'select', 'select_date'],

  // What AICA is willing to send for a contributing option. Liferay accepts
  // select_date as a contributor, but a select_date option value throws
  // ArrayIndexOutOfBoundsException on validation - see #654 - so it is not
  // offered here even though the platform permits it.
  SAFE_SKU_CONTRIBUTOR_FIELD_TYPES: ['radio', 'select'],

  // What a contributing option is corrected to when the model asks for a type
  // Liferay will not accept. 'select' because these options carry values.
  DEFAULT_SKU_CONTRIBUTOR_FIELD_TYPE: 'select',

  // Field types that support multiple values
  MULTIPLE_VALUES_FIELD_TYPES: [
    'checkbox',
    'checkbox_multiple',
    'radio',
    'select',
    'select_date',
  ],

  // Field types that require/support predefined OptionValues
  FIELD_TYPES_WITH_VALUES: [
    'checkbox',
    'checkbox_multiple',
    'radio',
    'select',
    'select_date',
  ],

  // All valid field types for commerce options as per OpenAPI spec
  VALID_FIELD_TYPES: [
    'checkbox',
    'checkbox_multiple',
    'date',
    'numeric',
    'radio',
    'select',
    'select_date',
    'text',
  ],
});

module.exports = {
  COMMERCE_CONSTRAINTS,
};
