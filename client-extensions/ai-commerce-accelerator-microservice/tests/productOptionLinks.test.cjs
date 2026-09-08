const {
  LINKED_OPTION_ID,
  LINKED_OPTION_VALUES,
  LINKED_OPTION_VALUE_ID,
  UNRESOLVED,
  findLinkedOption,
  readLinkedOption,
  resolveSkuOptionLink,
} = require('../utils/productOptionLinks.cjs');

// Shaped after a real POST /products/{id}/productOptions response: the
// relationship carries its own id, the global option it wraps is reported
// separately as optionId, and names come back as localised maps.
const linkedColour = {
  id: 71565,
  optionId: 44862,
  key: 'COLOR',
  name: { en_US: 'Color' },
  fieldType: 'select',
  skuContributor: true,
  productOptionValues: [
    { id: 71566, key: 'BLACK', name: { en_US: 'Black' } },
    { id: 71567, key: 'SILVER', name: { en_US: 'Silver' } },
  ],
};

describe('reading Liferay linked option ids', () => {
  it('takes the relationship id, not the global option id', () => {
    // Sku.skuOptions addresses the product definition's relationships. A live
    // capture has global option 71501 linked to product 71551, and the SKU
    // reporting optionId 71565 / optionValueId 71566.
    expect(readLinkedOption(linkedColour)).toEqual({
      [LINKED_OPTION_ID]: 71565,
      [LINKED_OPTION_VALUES]: [
        {
          [LINKED_OPTION_VALUE_ID]: 71566,
          key: 'BLACK',
          name: { en_US: 'Black' },
        },
        {
          [LINKED_OPTION_VALUE_ID]: 71567,
          key: 'SILVER',
          name: { en_US: 'Silver' },
        },
      ],
    });
  });

  it('reports no values when the response did not expand them', () => {
    // The reuse path and the create response are both entitled to answer
    // without nested values; the caller has to be able to see that.
    const { productOptionValues: _values, ...withoutValues } = linkedColour;

    expect(readLinkedOption(withoutValues)[LINKED_OPTION_VALUES]).toEqual([]);
  });

  it('returns nothing at all without a relationship id', () => {
    for (const linked of [
      undefined,
      null,
      {},
      { optionId: 44862 },
      { id: 0 },
    ]) {
      expect(readLinkedOption(linked)).toBeNull();
    }
  });

  it('drops a value Liferay reported without an id', () => {
    const linked = readLinkedOption({
      ...linkedColour,
      productOptionValues: [{ key: 'BLACK', name: { en_US: 'Black' } }],
    });

    expect(linked[LINKED_OPTION_VALUES]).toEqual([]);
  });
});

describe('matching what we sent against what Liferay linked', () => {
  it('matches on key regardless of case', () => {
    // The SDK's own key lookup compares case-insensitively, so the key Liferay
    // echoes is not guaranteed to be the key that was sent.
    expect(
      findLinkedOption([{ ...linkedColour, key: 'color' }], { key: 'COLOR' })
    ).toBeTruthy();
  });

  it('falls back to the global option id when the key does not match', () => {
    expect(
      findLinkedOption([{ ...linkedColour, key: 'colour' }], {
        key: 'COLOR',
        optionId: 44862,
      })
    ).toBeTruthy();
  });

  it('matches nothing rather than the wrong option', () => {
    expect(
      findLinkedOption([linkedColour], { key: 'SIZE', optionId: 44859 })
    ).toBeNull();
    expect(findLinkedOption(undefined, { key: 'COLOR' })).toBeNull();
  });
});

describe('resolving a variant option to a Liferay pair', () => {
  const productOptions = [
    {
      name: 'Color',
      key: 'COLOR',
      optionId: 44862,
      ...readLinkedOption(linkedColour),
    },
  ];

  it('resolves the relationship ids for a name the AI generated', () => {
    // skuVariants[].options is { "Color": "Black" } - option name to value
    // name, both plain strings per generation-schemas/product.json.
    expect(resolveSkuOptionLink(productOptions, 'Color', 'Black')).toEqual({
      optionId: 71565,
      optionValueId: 71566,
    });
  });

  it('compares localised names by their text, not by String()', () => {
    // String({en_US: 'Black'}) sanitises to 'OBJECTOBJECT', which matched
    // nothing - every value of every option resolved to zero. See #662.
    expect(
      resolveSkuOptionLink(productOptions, { en_US: 'Color' }, 'Black')
    ).toEqual({ optionId: 71565, optionValueId: 71566 });
  });

  it('matches a value on its key when the name does not carry the text', () => {
    const keyedOnly = [
      {
        ...productOptions[0],
        [LINKED_OPTION_VALUES]: [
          { [LINKED_OPTION_VALUE_ID]: 71566, key: 'BLACK', name: {} },
        ],
      },
    ];

    expect(resolveSkuOptionLink(keyedOnly, 'Color', 'Black')).toEqual({
      optionId: 71565,
      optionValueId: 71566,
    });
  });

  it('refuses a pair when the option was never linked', () => {
    // The global option id ensure-options resolves is a real id for the wrong
    // entity. Sending it produced {optionId: 44862, optionValueId: 0}, which
    // Liferay answered with ConstraintViolationException, losing every SKU.
    const neverLinked = [{ name: 'Color', key: 'COLOR', optionId: 44862 }];

    expect(resolveSkuOptionLink(neverLinked, 'Color', 'Black')).toEqual({
      reason: UNRESOLVED.OPTION_NOT_LINKED,
    });
  });

  it('refuses a pair when the linked option carries no values', () => {
    const withoutValues = [
      { ...productOptions[0], [LINKED_OPTION_VALUES]: [] },
    ];

    expect(resolveSkuOptionLink(withoutValues, 'Color', 'Black')).toEqual({
      reason: UNRESOLVED.VALUE_NOT_LINKED,
    });
  });

  it('names the failure it hit', () => {
    expect(resolveSkuOptionLink(productOptions, 'Size', '37L')).toEqual({
      reason: UNRESOLVED.OPTION_NOT_GENERATED,
    });
    expect(resolveSkuOptionLink(productOptions, 'Color', 'Purple')).toEqual({
      reason: UNRESOLVED.VALUE_NOT_MATCHED,
    });
  });
});
