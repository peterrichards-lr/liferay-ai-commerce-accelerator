/**
 * Turns generated option values into the shape Liferay requires.
 *
 * The prompt asks the AI for plain strings - `["Black", "Silver"]` - and
 * generation-schemas/product.json declares `items: { type: "string" }`. Liferay
 * requires objects: `ProductOptionValue` and `OptionValue` both declare
 * `required: ["key", "name"]`, with `name` a localised map. Something has to
 * translate, and it was being done inline in two places by reading `val.name`,
 * which is `undefined` for a string.
 *
 * The result was Liferay rejecting the whole option with
 * "optionValues[0].name must not be null" - first at ensure-options (#648),
 * then again at link-product-options, because the first fix corrected one site
 * without checking for others. Hence one function used by both.
 *
 * Objects are still accepted: the prompt is an editable configuration item, so
 * an operator may supply them, and Liferay's own responses are object-shaped
 * when values are read back.
 */

/**
 * A `{ key, name }` pair for one value, or null when it carries no usable
 * label.
 *
 * Null rather than a partial object on purpose: Liferay rejects the entire
 * option if any value lacks a name, so one unusable entry would otherwise
 * discard every other value on that option, and the option with it.
 */
function toOptionValue(value, deriveKey) {
  const label =
    typeof value === 'string'
      ? value
      : value?.name?.en_US || value?.name || value?.key || '';

  const name = typeof label === 'string' ? { en_US: label } : label || null;

  if (!name || !name.en_US) {
    return null;
  }

  return {
    key:
      (typeof value === 'object' && value?.key) ||
      (deriveKey ? deriveKey(name.en_US) : name.en_US),
    name,
  };
}

/**
 * Every usable value, with the unusable ones dropped.
 */
function toOptionValues(values, deriveKey) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value) => toOptionValue(value, deriveKey)).filter(Boolean);
}

module.exports = { toOptionValue, toOptionValues };
