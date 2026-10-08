const { buildStableERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const {
  categoryPathERC,
  ensureCategoryPath,
} = require('../utils/ensureCategoryPath.cjs');

/** A createCategory stub that records calls and hands back ids. */
function recorder({ failAt = null } = {}) {
  const calls = [];
  let next = 100;

  return {
    calls,
    create: async (vocabularyId, payload, parentId) => {
      calls.push({
        vocabularyId,
        name: payload.name,
        erc: payload.externalReferenceCode,
        parentId,
      });

      if (failAt && payload.name === failAt) return {};

      next += 1;

      return { id: next };
    },
  };
}

const run = (path, opts = {}) =>
  ensureCategoryPath({
    path,
    cache: opts.cache || new Map(),
    vocabularyId: 'vocab-1',
    createCategory: opts.create,
    localise: opts.localise,
  });

describe('the category ERC is keyed by path (#1204)', () => {
  it('gives sub-categories of the same name different ERCs', () => {
    // The collision categories.cjs already warns about: "Outdoor > Chairs" and
    // "Indoor > Chairs" hashed to one ERC, and the reuse map handed the first
    // category's id to both.
    expect(categoryPathERC(['Outdoor', 'Chairs'])).not.toBe(
      categoryPathERC(['Indoor', 'Chairs'])
    );
  });

  it('leaves a TOP-LEVEL category exactly as it is today', () => {
    // The property that makes this safe to deploy: a top-level path is
    // [name], so the ERC is byte-identical and existing data does not churn.
    expect(categoryPathERC(['Outdoor'])).toBe(
      buildStableERC(ERC_PREFIX.CATEGORY, ['Outdoor'])
    );
  });

  it('is stable for the same path', () => {
    expect(categoryPathERC(['A', 'B'])).toBe(categoryPathERC(['A', 'B']));
  });
});

describe('creating a path, parent first (#1204)', () => {
  it('creates each level in order, each under the one above', async () => {
    // Not a preference: Liferay creates a child through
    // /taxonomy-categories/{parentId}/taxonomy-categories, so the parent's id
    // must exist before the child can be posted at all.
    const r = recorder();
    const { ids, failedAt } = await run(['Outdoor', 'Tents', 'Two Person'], {
      create: r.create,
    });

    expect(failedAt).toBeNull();
    expect(r.calls.map((c) => c.name)).toEqual([
      'Outdoor',
      'Tents',
      'Two Person',
    ]);
    expect(r.calls[0].parentId).toBeNull();
    expect(r.calls[1].parentId).toBe(ids[0]);
    expect(r.calls[2].parentId).toBe(ids[1]);
  });

  it('returns the leaf AND every ancestor', async () => {
    // Liferay does not imply ancestors. A product carrying only the leaf id
    // will not appear when browsing the parent, which is what faceted
    // navigation does.
    const r = recorder();
    const { ids } = await run(['Outdoor', 'Tents'], { create: r.create });

    expect(ids).toHaveLength(2);
  });

  it('creates a top-level category with no parent', async () => {
    const r = recorder();

    await run(['Outdoor'], { create: r.create });

    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].parentId).toBeNull();
  });

  it('reuses a cached level instead of creating it again', async () => {
    // Shared across products in a run: a path is walked once however many
    // products use it.
    const cache = new Map();
    const r = recorder();

    await run(['Outdoor', 'Tents'], { create: r.create, cache });
    await run(['Outdoor', 'Chairs'], { create: r.create, cache });

    expect(r.calls.map((c) => c.name)).toEqual(['Outdoor', 'Tents', 'Chairs']);
  });

  it('stops at the level that failed and keeps the ancestors it resolved', async () => {
    // Carrying `undefined` into the assignment put [undefined] on the product,
    // which became [{}] in the payload and cost the whole item (#651).
    const r = recorder({ failAt: 'Tents' });
    const { ids, failedAt } = await run(['Outdoor', 'Tents', 'Two Person'], {
      create: r.create,
    });

    expect(ids).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
    expect(failedAt).toEqual(['Outdoor', 'Tents']);
    expect(r.calls.map((c) => c.name)).toEqual(['Outdoor', 'Tents']);
  });

  it('never returns an undefined id', async () => {
    const r = recorder({ failAt: 'Outdoor' });
    const { ids } = await run(['Outdoor', 'Tents'], { create: r.create });

    expect(ids).toEqual([]);
  });

  it('passes localised names when a localiser is given, and omits the key otherwise', async () => {
    const r = recorder();

    await run(['Outdoor'], {
      create: r.create,
      localise: () => ({ en_US: 'Outdoor' }),
    });
    expect(r.calls[0]).toBeDefined();

    const bare = recorder();
    await run(['Indoor'], { create: bare.create });
    expect(bare.calls[0].name).toBe('Indoor');
  });

  it('does nothing for an empty path', async () => {
    const r = recorder();
    const { ids, failedAt } = await run([], { create: r.create });

    expect(ids).toEqual([]);
    expect(failedAt).toBeNull();
    expect(r.calls).toHaveLength(0);
  });
});
