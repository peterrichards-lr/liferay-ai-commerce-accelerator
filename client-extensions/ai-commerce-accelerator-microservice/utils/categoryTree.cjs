/**
 * The configured category list, as a tree.
 *
 * Categories have always been a flat array of strings — shipped that way in
 * `categories.json` and seeded that way as `AI-CATEGORIES`. #1204 asks for
 * sub-categories at arbitrary depth, from both operator-authored and
 * model-generated sources.
 *
 * Both shapes are accepted, because every existing install has the flat one
 * and an upgrade that required re-authoring the list would be a migration
 * dressed as a feature:
 *
 *     ["Outdoor", "Indoor"]
 *     [{ name: "Outdoor", children: [{ name: "Tents" }] }, "Indoor"]
 *
 * and mixtures of the two.
 */

/** A name, whatever shape it arrived in. Localised maps resolve elsewhere. */
function nodeName(node) {
  if (typeof node === 'string') return node.trim();
  if (node && typeof node.name === 'string') return node.name.trim();

  return '';
}

/**
 * Normalises any accepted shape into `[{ name, children: [...] }]`.
 *
 * Unnamed nodes are dropped rather than carried as empty strings: a category
 * with no name cannot be created, matched or assigned, and keeping it would
 * push the failure to the point of use where it reads as a Liferay error.
 */
function normaliseCategoryTree(value) {
  if (!Array.isArray(value)) return [];

  const out = [];

  for (const node of value) {
    const name = nodeName(node);

    if (!name) continue;

    const rawChildren =
      node && typeof node === 'object' && Array.isArray(node.children)
        ? node.children
        : [];

    out.push({ name, children: normaliseCategoryTree(rawChildren) });
  }

  return out;
}

/**
 * Maps a lower-cased name to its full path, root first.
 *
 * Keyed by name rather than by path because that is what a product carries: the
 * generator assigns a category NAME, and this is what turns it back into the
 * ancestry Liferay needs.
 *
 * A name appearing in more than one branch keeps its FIRST path and is
 * reported. Resolving it correctly would need the product to say which branch
 * it meant, and it does not — so the alternative to a documented, stable
 * choice is a silently arbitrary one.
 */
function buildCategoryPathIndex(tree) {
  const index = new Map();
  const ambiguous = [];

  const walk = (nodes, prefix) => {
    for (const node of nodes) {
      const path = [...prefix, node.name];
      const key = node.name.toLowerCase();

      if (index.has(key)) {
        ambiguous.push({
          name: node.name,
          kept: index.get(key),
          ignored: path,
        });
      } else {
        index.set(key, path);
      }

      walk(node.children, path);
    }
  };

  walk(tree, []);

  return { index, ambiguous };
}

/**
 * The path for a category name — root first, leaf last.
 *
 * A name absent from the tree is its own path. The model can assign a category
 * that the operator never configured, and refusing it would lose the product
 * over a taxonomy detail; a top-level category is the honest representation of
 * "no known parent".
 */
function categoryPathFor(index, name) {
  if (!name) return [];

  return index.get(String(name).toLowerCase()) || [String(name)];
}

module.exports = {
  normaliseCategoryTree,
  buildCategoryPathIndex,
  categoryPathFor,
};
