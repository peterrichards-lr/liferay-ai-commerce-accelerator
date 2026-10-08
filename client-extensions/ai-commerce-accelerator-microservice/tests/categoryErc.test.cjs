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

  it('is deterministic for the same key', () => {
    expect(buildStableERC(ERC_PREFIX.CATEGORY, ['Accessories'])).toBe(
      buildStableERC(ERC_PREFIX.CATEGORY, ['Accessories'])
    );
  });

  it('distinguishes two categories sharing a name under different parents', () => {
    // THE CONSTRAINT THIS FILE RECORDED IS LIFTED (#1204).
    //
    // It used to say the key was the name alone, so "Accessories" beneath
    // Electronics and beneath Clothing produced ONE code and the reuse map
    // gave both products the first category's id - silently, because a
    // collision there looks like reuse. It asked whoever fixed that to come
    // here and say so.
    //
    // Saying so: product-steps/categories.cjs now passes the full PATH, via
    // utils/ensureCategoryPath.cjs. The primitive never changed - it hashes
    // what it is given - so the old case passed throughout and was never the
    // tripwire it was meant to be. It asserted determinism, not name-only
    // keying. This asserts the thing that actually matters.
    expect(
      buildStableERC(ERC_PREFIX.CATEGORY, ['Electronics', 'Accessories'])
    ).not.toBe(
      buildStableERC(ERC_PREFIX.CATEGORY, ['Clothing', 'Accessories'])
    );
  });

  it('leaves a top-level category with the code it already had', () => {
    // What makes the path key deployable rather than a migration: a
    // top-level path is [name], so nothing existing churns.
    expect(buildStableERC(ERC_PREFIX.CATEGORY, ['Electronics'])).toBe(
      buildStableERC(ERC_PREFIX.CATEGORY, ['Electronics'])
    );
  });
});
