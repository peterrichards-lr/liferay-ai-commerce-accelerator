const { translateWarehouse } = require('./datasetTranslation.cjs');
const {
  LINKED_OPTION_ID,
  LINKED_OPTION_VALUES,
} = require('./productOptionLinks.cjs');

/**
 * Trading instance-local identity for the identity that travels.
 *
 * A session records what Liferay answered, which is right for a session: it is
 * a log of what happened on one instance. It is wrong for a package, which
 * exists to be opened somewhere else - and the two were the same object,
 * because `datasetFromSession` exported the run context verbatim.
 *
 * The failure it produced was total and silent (#929). An exported package
 * carried warehouses with their source `id`; `create-warehouses` filters to
 * `!warehouse.id` on the rule that an id means "adopted from the target, do
 * not re-submit" (#730), so it created none of them, reported success, and the
 * run failed one step later resolving warehouses that did not exist.
 *
 * The nested case is worse and fails quietly rather than loudly: a product
 * carries `specificationId` and `optionId` stamped from the source, and
 * Liferay's ids are sequential per instance - so on another instance they do
 * not dangle, they resolve, to whatever entity holds that number.
 *
 * **An id is not dropped where it can be translated.** The dataset carries the
 * definitions those ids point at, and each definition knows its own external
 * reference code, so the reference can be rewritten as the portable identity
 * rather than deleted. The target then creates the entity, mints its own id,
 * and matches by code. Dropping is the fallback for a reference whose
 * definition is not in the package - there is nothing to translate to, and a
 * number that means something else on the target is worse than no number.
 *
 * **Why this is safe today**: the import runs `ensure-specifications` and
 * `ensure-options` before `create-products` (`routes/import.cjs:160-162`), and
 * both re-stamp ids from the target's own entities, matching on key and code.
 * The translation makes the package honest; it does not make the import depend
 * on anything new.
 */

/** Identity that means something only on the instance that issued it. */
const INSTANCE_KEYS = Object.freeze([
  'id',
  // Liferay's HATEOAS block: absolute URLs to the source, embedded in an
  // artefact whose purpose is to be opened elsewhere.
  'actions',
]);

function withoutInstanceKeys(entity) {
  if (!entity || typeof entity !== 'object') return entity;

  const portable = { ...entity };

  for (const key of INSTANCE_KEYS) {
    delete portable[key];
  }

  return portable;
}

/**
 * `id` to external reference code, read off the definitions the package
 * already carries. A definition with no code contributes nothing - there is
 * no portable identity to offer, and inventing one would be worse.
 */
function codesById(definitions) {
  const codes = new Map();

  for (const definition of definitions || []) {
    const id = definition?.id;
    const code = definition?.externalReferenceCode;

    if (id !== undefined && id !== null && code) {
      codes.set(String(id), code);
    }
  }

  return codes;
}

/**
 * One nested reference, rewritten.
 *
 * The code is added only when the package can supply it, and the id always
 * goes: keeping it would leave the target free to resolve a number that means
 * something else there.
 */
function translateReference(reference, { codeField, codes, idField }) {
  const { [idField]: id, ...rest } = reference || {};
  const code = rest[codeField] || codes.get(String(id));

  return code ? { ...rest, [codeField]: code } : rest;
}

function portableProduct(product, { optionCodes, specificationCodes } = {}) {
  if (!product || typeof product !== 'object') return product;

  const portable = withoutInstanceKeys(product);
  const codes = {
    option: optionCodes || new Map(),
    specification: specificationCodes || new Map(),
  };

  for (const field of ['productSpecifications', 'specifications']) {
    if (Array.isArray(portable[field])) {
      portable[field] = portable[field].map((specification) =>
        translateReference(specification, {
          codeField: 'specificationExternalReferenceCode',
          codes: codes.specification,
          idField: 'specificationId',
        })
      );
    }
  }

  for (const field of ['productOptions', 'options']) {
    if (Array.isArray(portable[field])) {
      portable[field] = portable[field].map((option) => {
        const translated = withoutInstanceKeys(
          translateReference(option, {
            codeField: 'optionExternalReferenceCode',
            codes: codes.option,
            idField: 'optionId',
          })
        );

        // The relationship between a product and an option, and between that
        // and its values, exists only on the instance that made it - there is
        // no external reference code to translate these into, because the
        // relationship does not exist on the target until
        // link-product-options builds it. Carried across, they are #662 in
        // waiting: a plausible-looking id that addresses a different entity,
        // reaching a SKU. The portable form is the names, which stay.
        delete translated[LINKED_OPTION_ID];
        delete translated[LINKED_OPTION_VALUES];

        return translated;
      });
    }
  }

  return portable;
}

/**
 * The dataset as something another instance can accept.
 *
 * Idempotent by construction: a dataset built by `instanceExtractor`, which
 * normalises on its way out already, passes through unchanged - so the two
 * producers converge rather than disagreeing about what a package holds.
 */
function toPortableDataset(dataset) {
  if (!dataset || typeof dataset !== 'object') return dataset;

  const optionCodes = codesById(dataset.optionDefinitions);
  const specificationCodes = codesById(dataset.specificationDefinitions);

  return {
    ...dataset,
    // The normaliser the extract path already uses, rather than a second one:
    // two answers to "what does a warehouse look like in a package" is how
    // they drift into disagreeing.
    warehouses: (dataset.warehouses || []).map((warehouse) =>
      translateWarehouse(warehouse)
    ),
    products: (dataset.products || []).map((product) =>
      portableProduct(product, { optionCodes, specificationCodes })
    ),
    specificationDefinitions: (dataset.specificationDefinitions || []).map(
      withoutInstanceKeys
    ),
    optionDefinitions: (dataset.optionDefinitions || []).map(
      withoutInstanceKeys
    ),
  };
}

module.exports = {
  INSTANCE_KEYS,
  codesById,
  portableProduct,
  toPortableDataset,
  withoutInstanceKeys,
};
