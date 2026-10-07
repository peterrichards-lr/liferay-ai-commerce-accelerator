const { buildStableERC } = require('./misc.cjs');
const { ERC_PREFIX } = require('./constants.cjs');

/**
 * The ERC for a category, keyed by its full path.
 *
 * The hash used to cover the leaf name alone. That was sound while categories
 * were a flat set of unique strings; under #1204 two sub-categories sharing a
 * name under different parents — "Outdoor > Chairs" and "Indoor > Chairs" —
 * collide on one ERC, and the reuse map hands the first category's id to both.
 *
 * A TOP-LEVEL category's path is `[name]`, so its ERC is byte-identical to the
 * one it already has. Existing data does not churn; only the levels that could
 * not previously exist get new identifiers.
 */
function categoryPathERC(path) {
  return buildStableERC(ERC_PREFIX.CATEGORY, path);
}

/**
 * Creates every level of a category path that does not yet exist, parent first,
 * and returns the ids root-first.
 *
 * Returns ALL of them, not just the leaf. Liferay does not imply ancestors, so
 * a product filed under "Outdoor > Tents" that carries only the Tents id will
 * not appear when browsing Outdoor — which is what faceted navigation does.
 *
 * Parent first is not a preference: Liferay creates a child through
 * `/taxonomy-categories/{parentId}/taxonomy-categories`, so the parent's id has
 * to exist before the child can be posted at all.
 *
 * `cache` is keyed by ERC and shared across products in a run, so a path is
 * walked once however many products use it.
 */
async function ensureCategoryPath({
  path,
  cache,
  vocabularyId,
  createCategory,
  localise,
}) {
  const ids = [];
  let parentId = null;

  for (let depth = 0; depth < path.length; depth += 1) {
    const prefix = path.slice(0, depth + 1);
    const name = prefix[prefix.length - 1];
    const erc = categoryPathERC(prefix);
    const key = erc.toUpperCase();

    let id = cache.get(key);

    if (!id) {
      const payload = {
        name,
        externalReferenceCode: erc,
      };

      const nameI18n = localise ? localise(name) : null;

      if (nameI18n) payload.name_i18n = nameI18n;

      // The parent is passed positionally as the SDK's fourth argument. A
      // falsy parent means top level, which is how the vocabulary-scoped
      // endpoint is still reached for depth 0.
      const created = await createCategory(vocabularyId, payload, parentId);

      id = created?.id;

      if (!id) {
        // Stop at the level that failed rather than carrying `undefined` into
        // the assignment. `[undefined]` became `[{}]` in the payload and cost
        // the whole product (#651); the ancestors resolved so far are still
        // valid and are returned.
        return { ids, failedAt: prefix };
      }

      cache.set(key, id);
    }

    ids.push(id);
    parentId = id;
  }

  return { ids, failedAt: null };
}

module.exports = { categoryPathERC, ensureCategoryPath };
