const { buildStableERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

/**
 * Taxonomy category ERCs must carry the AICA namespace.
 *
 * `product-steps/categories.cjs` built them with
 * `buildStableERC(ERC_PREFIX.CATEGORY || 'CAT', [name])`, and
 * `ERC_PREFIX.CATEGORY` did not exist - the object defines OPTION_CATEGORY and
 * SPECIFICATION_CATEGORY and nothing else category-shaped. So the `||` was the
 * only branch ever taken, and every taxonomy category AICA created sat outside
 * the namespace that makes our content identifiable, and removable, in an
 * instance we share with other content.
 *
 * It survived because a wrong-but-consistent prefix produces correct-looking
 * categories on every run, and nothing asserted it. See #1206.
 */
describe('taxonomy category ERCs (#1206)', () => {
  it('has a CATEGORY prefix at all', () => {
    // The line that would have to change for this to fail: deleting CATEGORY
    // from ERC_PREFIX. `buildStableERC` then falls back to its own 'GEN', so
    // the case below goes red rather than quietly producing a different code.
    expect(ERC_PREFIX.CATEGORY).toBeDefined();
  });

  it('builds a namespaced code, not a bare CAT', () => {
    const erc = buildStableERC(ERC_PREFIX.CATEGORY, ['Electronics']);

    expect(erc).toMatch(/^AICA-CAT-/);
    // The shape that shipped, and the reason this file exists.
    expect(erc).not.toMatch(/^CAT-/);
    expect(erc).not.toMatch(/^GEN-/);
  });

  it('keeps every prefix inside the namespace, including ones added later', () => {
    // A class guard rather than a case for one key: the next prefix added
    // without AICA- fails here instead of being found in an instance.
    const outside = Object.entries(ERC_PREFIX).filter(
      ([, value]) => !String(value).startsWith('AICA-')
    );

    expect(outside).toEqual([]);
  });

  it('distinguishes two categories with different names', () => {
    expect(buildStableERC(ERC_PREFIX.CATEGORY, ['Electronics'])).not.toBe(
      buildStableERC(ERC_PREFIX.CATEGORY, ['Clothing'])
    );
  });

  it('cannot yet distinguish two categories sharing a name', () => {
    // Recorded as a constraint rather than asserted as correct. The key is the
    // name alone, so under #1204 "Accessories" beneath Electronics and
    // "Accessories" beneath Clothing would produce ONE code, and the reuse map
    // in product-steps/categories.cjs would give both products the first
    // category's id - silently, because a collision there looks like reuse.
    //
    // This case exists so that adding the parent to the key breaks it visibly,
    // and whoever does that has to come here and say so.
    expect(buildStableERC(ERC_PREFIX.CATEGORY, ['Accessories'])).toBe(
      buildStableERC(ERC_PREFIX.CATEGORY, ['Accessories'])
    );
  });
});
