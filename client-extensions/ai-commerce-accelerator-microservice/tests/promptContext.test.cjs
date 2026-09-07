const {
  brandGuidance,
  currencyGuidance,
  vocabularyGuidance,
} = require('../utils/promptContext.cjs');

describe('prompt context blocks', () => {
  describe('brandGuidance', () => {
    it('presents the value as context rather than quoting it as a name', () => {
      // The field is free text - "Brand / Context" in the UI - so it may be a
      // sentence. `the brand/company "A premium outdoor gear brand..."` is how
      // the prompts used to read.
      const text = brandGuidance(
        'A premium outdoor gear brand focusing on sustainability'
      );

      expect(text).toContain('BRAND CONTEXT: A premium outdoor gear brand');
      expect(text).not.toContain('brand/company "');
    });

    it('says nothing at all when no brand was given', () => {
      // The case the broken conditional could not express: it emitted the
      // block regardless, so a run with no brand told the model the products
      // belong to the brand/company "".
      for (const value of ['', '   ', null, undefined]) {
        expect(brandGuidance(value)).toBe('');
      }
    });
  });

  describe('vocabularyGuidance', () => {
    const grounding = {
      vocabularies: [
        {
          categories: [{ name: 'Wrenches' }, { name: 'Drivers' }],
          name: 'Tool Type',
        },
      ],
    };

    it('lists each vocabulary with its categories', () => {
      const text = vocabularyGuidance(grounding);

      expect(text).toContain('MUST categorize');
      expect(text).toContain('- Vocabulary "Tool Type": Wrenches, Drivers');
    });

    it('withholds the instruction when there is nothing to list', () => {
      // This is the one that matters. A mandatory instruction followed by no
      // data is worse than no instruction, and it is exactly what the
      // unexpanded {% for %} produced.
      for (const value of [null, undefined, {}, { vocabularies: [] }]) {
        expect(vocabularyGuidance(value)).toBe('');
      }
    });

    it('skips a vocabulary with no usable categories', () => {
      expect(
        vocabularyGuidance({
          vocabularies: [{ categories: [], name: 'Empty' }],
        })
      ).toBe('');
    });

    it('drops categories with no name rather than emitting a gap', () => {
      const text = vocabularyGuidance({
        vocabularies: [
          { categories: [{ name: 'Wrenches' }, {}], name: 'Tool Type' },
        ],
      });

      expect(text).toContain('"Tool Type": Wrenches');
    });
  });

  describe('currencyGuidance', () => {
    it('lists the active currency codes', () => {
      expect(
        currencyGuidance({ currencies: [{ code: 'USD' }, { code: 'EUR' }] })
      ).toContain('USD, EUR');
    });

    it('says nothing when no currencies are known', () => {
      for (const value of [null, undefined, {}, { currencies: [] }]) {
        expect(currencyGuidance(value)).toBe('');
      }
    });
  });
});
