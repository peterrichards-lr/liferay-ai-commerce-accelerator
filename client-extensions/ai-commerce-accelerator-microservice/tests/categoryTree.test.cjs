const {
  normaliseCategoryTree,
  buildCategoryPathIndex,
  categoryPathFor,
} = require('../utils/categoryTree.cjs');

/**
 * Categories as a tree, accepting the flat list every install already has.
 *
 * #1204: categories and sub-categories at arbitrary depth, from operator and
 * model alike, with a product assigned its leaf AND every ancestor.
 */
describe('normalising the configured list (#1204)', () => {
  it('accepts the flat array of strings that ships today', () => {
    // Every existing install has this. An upgrade that required re-authoring
    // the list would be a migration dressed as a feature.
    expect(normaliseCategoryTree(['Outdoor', 'Indoor'])).toEqual([
      { name: 'Outdoor', children: [] },
      { name: 'Indoor', children: [] },
    ]);
  });

  it('accepts a tree, and mixtures of both', () => {
    expect(
      normaliseCategoryTree([
        'Outdoor',
        { name: 'Indoor', children: [{ name: 'Rugs' }, 'Lamps'] },
      ])
    ).toEqual([
      { name: 'Outdoor', children: [] },
      {
        name: 'Indoor',
        children: [
          { name: 'Rugs', children: [] },
          { name: 'Lamps', children: [] },
        ],
      },
    ]);
  });

  it('goes deeper than one level', () => {
    const tree = normaliseCategoryTree([
      { name: 'A', children: [{ name: 'B', children: [{ name: 'C' }] }] },
    ]);

    expect(tree[0].children[0].children[0].name).toBe('C');
  });

  it('drops unnamed nodes rather than carrying empty names', () => {
    // A nameless category cannot be created, matched or assigned. Keeping it
    // moves the failure to the point of use, where it reads as a Liferay error.
    expect(normaliseCategoryTree(['', '  ', {}, { name: '' }, 'Real'])).toEqual(
      [{ name: 'Real', children: [] }]
    );
  });

  it('survives a non-array, which is what a missing config looks like', () => {
    for (const v of [null, undefined, {}, 'Outdoor', 42]) {
      expect(normaliseCategoryTree(v)).toEqual([]);
    }
  });

  it('trims, so " Tents" and "Tents" are one category', () => {
    expect(normaliseCategoryTree([' Tents '])).toEqual([
      { name: 'Tents', children: [] },
    ]);
  });
});

describe('resolving a name to its ancestry (#1204)', () => {
  const tree = normaliseCategoryTree([
    {
      name: 'Outdoor',
      children: [{ name: 'Tents', children: [{ name: 'Two Person' }] }],
    },
    { name: 'Indoor', children: [{ name: 'Rugs' }] },
  ]);

  it('returns the full path, root first', () => {
    const { index } = buildCategoryPathIndex(tree);

    expect(categoryPathFor(index, 'Two Person')).toEqual([
      'Outdoor',
      'Tents',
      'Two Person',
    ]);
  });

  it('matches case-insensitively, as the product data does', () => {
    const { index } = buildCategoryPathIndex(tree);

    expect(categoryPathFor(index, 'tENTs')).toEqual(['Outdoor', 'Tents']);
  });

  it('treats a top-level category as a path of one', () => {
    const { index } = buildCategoryPathIndex(tree);

    expect(categoryPathFor(index, 'Indoor')).toEqual(['Indoor']);
  });

  it('treats an unconfigured name as its own top-level category', () => {
    // The model can assign a category the operator never configured. Refusing
    // it would lose the product over a taxonomy detail.
    const { index } = buildCategoryPathIndex(tree);

    expect(categoryPathFor(index, 'Invented')).toEqual(['Invented']);
  });

  it('reports a name that appears in two branches, and keeps the first', () => {
    // The product carries a NAME, not a path, so nothing says which branch it
    // meant. The alternative to a documented, stable choice is a silently
    // arbitrary one.
    const ambiguousTree = normaliseCategoryTree([
      { name: 'Outdoor', children: [{ name: 'Chairs' }] },
      { name: 'Indoor', children: [{ name: 'Chairs' }] },
    ]);
    const { index, ambiguous } = buildCategoryPathIndex(ambiguousTree);

    expect(categoryPathFor(index, 'Chairs')).toEqual(['Outdoor', 'Chairs']);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]).toMatchObject({
      name: 'Chairs',
      kept: ['Outdoor', 'Chairs'],
      ignored: ['Indoor', 'Chairs'],
    });
  });

  it('reports nothing when every name is unique', () => {
    expect(buildCategoryPathIndex(tree).ambiguous).toEqual([]);
  });

  it('returns an empty path for an empty name', () => {
    const { index } = buildCategoryPathIndex(tree);

    for (const v of ['', null, undefined]) {
      expect(categoryPathFor(index, v)).toEqual([]);
    }
  });
});
