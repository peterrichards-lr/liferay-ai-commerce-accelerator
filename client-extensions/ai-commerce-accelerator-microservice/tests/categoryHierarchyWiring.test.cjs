const {
  runEnsureCategoriesStep,
} = require('../generators/product-steps/categories.cjs');

/**
 * The join: configured tree -> path -> parent-first create -> leaf + ancestors.
 *
 * The pieces are tested on their own (categoryTree, ensureCategoryPath). This
 * asserts they are actually wired together, which is the part that silently
 * does nothing if a call site is wrong — the defect family this repository
 * keeps producing. See #1204.
 */
function harness({ categories, products, created = [], existing = [] } = {}) {
  const context = {
    config: { localeCode: 'en-US', siteGroupId: 7 },
    productDataList: products,
  };

  const calls = [];
  let nextId = 500;

  const self = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ctx: { config: { getCategories: vi.fn(async () => categories) } },
    persistence: {
      getSession: vi.fn(async () => ({ context, correlationId: 'c1' })),
      updateSessionContext: vi.fn(async (_id, patch) => {
        Object.assign(context, patch);
      }),
      createBatch: vi.fn(async () => ({})),
    },
    completeSyncStep: vi.fn(async () => ({})),
    liferay: {
      getTaxonomyVocabularies: vi.fn(async () => ({
        items: [{ id: 'vocab-1', name: 'Category' }],
      })),
      getTaxonomyCategories: vi.fn(async () => ({ items: existing })),
      createTaxonomyCategory: vi.fn(
        async (_cfg, vocabId, payload, parentId) => {
          calls.push({
            vocabId,
            name: payload.name,
            erc: payload.externalReferenceCode,
            parentId,
          });
          created.push(payload.name);
          nextId += 1;

          return { id: nextId };
        }
      ),
      rest: { _get: vi.fn(async () => ({ items: [] })) },
    },
  };

  return { self, context, calls };
}

describe('the category hierarchy is actually wired in (#1204)', () => {
  it('creates a sub-category under its parent, parent first', async () => {
    const { self, calls } = harness({
      categories: [{ name: 'Outdoor', children: [{ name: 'Tents' }] }],
      products: [{ externalReferenceCode: 'P1', category: 'Tents' }],
    });

    await runEnsureCategoriesStep.call(self, 's1');

    expect(calls.map((c) => c.name)).toEqual(['Outdoor', 'Tents']);
    expect(calls[0].parentId).toBeNull();
    // The whole point: the child is posted under the parent's id.
    expect(calls[1].parentId).toBe(calls[0] && 501);
  });

  it('assigns the leaf AND its ancestors to the product', async () => {
    // Liferay does not imply ancestors. Carrying only the leaf means the
    // product does not appear when browsing the parent.
    const { self, context } = harness({
      categories: [{ name: 'Outdoor', children: [{ name: 'Tents' }] }],
      products: [{ externalReferenceCode: 'P1', category: 'Tents' }],
    });

    await runEnsureCategoriesStep.call(self, 's1');

    expect(context.productDataList[0].categories).toHaveLength(2);
  });

  it('keys the ERC by the path, so same-named siblings do not collide', async () => {
    const { self, calls } = harness({
      categories: [
        { name: 'Outdoor', children: [{ name: 'Chairs' }] },
        { name: 'Indoor', children: [{ name: 'Chairs' }] },
      ],
      products: [
        { externalReferenceCode: 'P1', category: 'Chairs' },
        { externalReferenceCode: 'P2', category: 'Chairs' },
      ],
    });

    await runEnsureCategoriesStep.call(self, 's1');

    const chairs = calls.filter((c) => c.name === 'Chairs');

    expect(chairs.length).toBeGreaterThan(0);
    // Both products say "Chairs"; the tree resolves to ONE path, so one
    // category is created and reused — not two colliding on a single ERC.
    expect(new Set(chairs.map((c) => c.erc)).size).toBe(chairs.length);
  });

  it('still works when the configured list is the flat array that ships today', async () => {
    const { self, calls, context } = harness({
      categories: ['Electronics'],
      products: [{ externalReferenceCode: 'P1', category: 'Electronics' }],
    });

    await runEnsureCategoriesStep.call(self, 's1');

    expect(calls.map((c) => c.name)).toEqual(['Electronics']);
    expect(calls[0].parentId).toBeNull();
    expect(context.productDataList[0].categories).toHaveLength(1);
  });

  it('falls back to flat when the configured list cannot be read', async () => {
    // A taxonomy refinement must not cost the product run.
    const { self, calls, context } = harness({
      categories: [{ name: 'Outdoor', children: [{ name: 'Tents' }] }],
      products: [{ externalReferenceCode: 'P1', category: 'Tents' }],
    });

    self.ctx.config.getCategories = vi.fn(async () => {
      throw new Error('config unreachable');
    });

    await runEnsureCategoriesStep.call(self, 's1');

    expect(calls.map((c) => c.name)).toEqual(['Tents']);
    expect(context.productDataList[0].categories).toHaveLength(1);
    expect(self.logger.warn).toHaveBeenCalled();
  });

  it('gives an unconfigured category a top-level home rather than dropping the product', async () => {
    const { self, calls, context } = harness({
      categories: [{ name: 'Outdoor', children: [{ name: 'Tents' }] }],
      products: [{ externalReferenceCode: 'P1', category: 'Invented' }],
    });

    await runEnsureCategoriesStep.call(self, 's1');

    expect(calls.map((c) => c.name)).toEqual(['Invented']);
    expect(context.productDataList[0].categories).toHaveLength(1);
  });
});
