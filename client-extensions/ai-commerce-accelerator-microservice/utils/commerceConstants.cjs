/**
 * Liferay Commerce Constants and Constraints
 */

const COMMERCE_CONSTRAINTS = Object.freeze({
  // Field types allowed for options that contribute to SKUs (variants)
  SKU_CONTRIBUTOR_FIELD_TYPES: [
    'checkbox',
    'checkbox_multiple',
    'radio',
    'select',
    'select_date',
  ],

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
