const { toOptionValue, toOptionValues } = require('../utils/optionValues.cjs');

const key = (label) =>
  String(label)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-');

describe('option value translation', () => {
  it('turns the plain strings the AI returns into what Liferay requires', () => {
    // The prompt asks for ["Black", "Silver"] and the generation schema
    // declares items: { type: 'string' }. Liferay's ProductOptionValue and
    // OptionValue both declare required: ['key', 'name'].
    expect(toOptionValues(['Red', 'Blue'], key)).toEqual([
      { key: 'RED', name: { en_US: 'Red' } },
      { key: 'BLUE', name: { en_US: 'Blue' } },
    ]);
  });

  it('still accepts objects, since the prompt is editable', () => {
    expect(toOptionValues([{ name: { en_US: 'Large' } }], key)).toEqual([
      { key: 'LARGE', name: { en_US: 'Large' } },
    ]);
  });

  it('keeps an explicitly supplied key rather than deriving one', () => {
    expect(toOptionValues([{ key: 'sm', name: 'Small' }], key)).toEqual([
      { key: 'sm', name: { en_US: 'Small' } },
    ]);
  });

  it('drops an unusable value rather than sending a null name', () => {
    // Liferay rejects the whole option if any value lacks a name, so one bad
    // entry would otherwise discard every other value on that option.
    expect(toOptionValues(['Red', '', null, {}, undefined], key)).toEqual([
      { key: 'RED', name: { en_US: 'Red' } },
    ]);
  });

  it('returns nothing for a non-array', () => {
    for (const value of [undefined, null, 'Red', 42]) {
      expect(toOptionValues(value, key)).toEqual([]);
    }
  });

  it('derives a key from the label when none is given and no deriver is passed', () => {
    expect(toOptionValue('Red')).toEqual({
      key: 'Red',
      name: { en_US: 'Red' },
    });
  });

  it('returns null only when there is no label to be had', () => {
    for (const value of ['', null, undefined, {}]) {
      expect(toOptionValue(value, key)).toBeNull();
    }
  });

  it('falls back to the key as the label when only a key is given', () => {
    // Using the key as the label keeps the value, which is better than
    // dropping it: Liferay needs a name, and 'k' is more useful than nothing.
    expect(toOptionValue({ key: 'k' }, key)).toEqual({
      key: 'k',
      name: { en_US: 'k' },
    });
  });
});
