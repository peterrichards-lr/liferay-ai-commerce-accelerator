/**
 * The two names a product's options and specifications travel under.
 *
 * `options`/`specifications` are what the generation schemas declare and the
 * prompts ask for. `productOptions`/`productSpecifications` are Liferay's, so
 * they are what an extracted dataset carries and what the product step sends.
 * Neither name can be dropped, and every reader used to carry its own
 * `a || b || []` - sixteen of them across four product steps and two utilities.
 *
 * That was not merely repetition. `generation.cjs` assigns both names the same
 * array; `specifications.cjs` deep-clones the session context, which splits
 * them into two independent arrays, and then mutates whichever the `||`
 * happened to pick. The other copy silently keeps the pre-resolution values,
 * and nothing breaks only because every downstream reader happens to check the
 * same name first. When that stops being true the failure is silent:
 * specifications do not link, and it presents as missing storefront data
 * rather than a failed run. See #652 and #698.
 *
 * So reads go through `productOptionsOf`/`productSpecificationsOf`, and every
 * site that rewrites one goes through `applyProductOptions`/
 * `applyProductSpecifications`, which point every name the product already
 * carries at the one array. Names the product does not carry are not added:
 * an extracted dataset holds Liferay's names alone, and giving it the schema
 * names too would change the shape a round trip has to preserve.
 */

const OPTION_FIELDS = ['productOptions', 'options'];
const SPECIFICATION_FIELDS = ['productSpecifications', 'specifications'];

function readFirst(product, fields) {
  for (const field of fields) {
    const value = product?.[field];

    if (value) {
      return value;
    }
  }

  return [];
}

function mirror(product, fields, value) {
  const patch = {};

  for (const field of fields) {
    if (product?.[field] !== undefined) {
      patch[field] = value;
    }
  }

  return patch;
}

function productOptionsOf(product) {
  return readFirst(product, OPTION_FIELDS);
}

function productSpecificationsOf(product) {
  return readFirst(product, SPECIFICATION_FIELDS);
}

/**
 * Whether the product said anything at all about its options.
 *
 * Distinct from `productOptionsOf(product).length`: a product that declares an
 * empty list has been asked about and answered, and a caller writing a derived
 * list back needs to tell that from a product that never carried the field.
 */
function declaresProductOptions(product) {
  return Boolean(product?.productOptions || product?.options);
}

function mirrorProductOptions(product, options) {
  return mirror(product, OPTION_FIELDS, options);
}

function mirrorProductSpecifications(product, specifications) {
  return mirror(product, SPECIFICATION_FIELDS, specifications);
}

function applyProductOptions(product, options) {
  return Object.assign(product, mirrorProductOptions(product, options));
}

function applyProductSpecifications(product, specifications) {
  return Object.assign(
    product,
    mirrorProductSpecifications(product, specifications)
  );
}

module.exports = {
  applyProductOptions,
  applyProductSpecifications,
  declaresProductOptions,
  mirrorProductOptions,
  mirrorProductSpecifications,
  productOptionsOf,
  productSpecificationsOf,
};
