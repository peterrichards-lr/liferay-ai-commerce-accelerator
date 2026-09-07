const {
  accountGeography,
  accountTypeGuidance,
  brandGuidance,
  currencyGuidance,
  languageGuidance,
  orderDateGuidance,
  vocabularyGuidance,
  warehouseGeography,
} = require('../utils/promptContext.cjs');
const fs = require('fs');
const path = require('path');

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

  describe('languageGuidance', () => {
    it('joins the active language ids', () => {
      expect(
        languageGuidance({ languages: [{ id: 'en-US' }, { id: 'fr-FR' }] })
      ).toContain('en-US, fr-FR');
    });

    it('returns nothing when no languages are known', () => {
      expect(languageGuidance(null)).toBe('');
      expect(languageGuidance({ languages: [] })).toBe('');
    });
  });

  describe('warehouseGeography', () => {
    it('uses the exact codes when a geographic context is given', () => {
      const geo = warehouseGeography({
        countryISOCode: 'DE',
        regionISOCode: 'HH',
        regionTitle: 'Hamburg',
        countryTitle: 'Germany',
      });

      expect(geo.countryInstruction).toBe('DE');
      expect(geo.regionInstruction).toBe('HH');
      expect(geo.cityInstruction).toBe('A city within Hamburg, Germany.');
      expect(geo.geographyCritical).toContain('"DE"');
    });

    it('asks for well-formed codes when there is no context', () => {
      const geo = warehouseGeography(null);

      expect(geo.countryInstruction).toContain('2 uppercase');
      expect(geo.cityInstruction).toBe(
        'A city where the warehouse is located.'
      );
      // The old template emitted both branches, so the model was told to use
      // exact values AND to invent them.
      expect(geo.geographyCritical).not.toContain('MUST be "');
    });
  });

  describe('accountGeography', () => {
    it('omits the region line entirely when no region is known', () => {
      expect(accountGeography({ countryTitle: 'Spain' }).regionLine).toBe('');
      expect(accountGeography(null).regionLine).toBe('');
    });

    it('emits the region line when a region is known', () => {
      expect(
        accountGeography({ countryTitle: 'Spain', regionTitle: 'Madrid' })
          .regionLine
      ).toBe('\n- headOfficeAddress.addressRegion: Madrid');
    });
  });

  describe('accountTypeGuidance', () => {
    // The template's three-way branch emitted all three at once.
    it('describes person accounts only', () => {
      const text = accountTypeGuidance({ accountType: 'person' });

      expect(text).toContain('must be an individual/consumer account');
      expect(text).not.toContain('must be a business account');
      expect(text).not.toContain('realistic mix');
    });

    it('describes business accounts only', () => {
      const text = accountTypeGuidance({ accountType: 'business' });

      expect(text).toContain('must be a business account');
      expect(text).not.toContain('individual/consumer');
    });

    it('describes a mix only', () => {
      const text = accountTypeGuidance({ accountType: 'mixed', count: 10 });

      expect(text).toContain('realistic mix');
      expect(text).not.toContain('Every account must be');
    });

    it('defaults to business for an unknown type', () => {
      expect(accountTypeGuidance({}).toLowerCase()).toContain('business');
    });
  });

  describe('orderDateGuidance', () => {
    it('spreads dates across the range when one is set', () => {
      const text = orderDateGuidance(90);

      expect(text).toContain('last 90 days');
      expect(text).toContain('REORDER PATTERNS');
      expect(text).not.toContain('current date/time');
    });

    it('uses the current date when there is no range', () => {
      for (const value of [0, undefined, null]) {
        const text = orderDateGuidance(value);

        expect(text).toContain('current date/time');
        expect(text).not.toContain('REORDER PATTERNS');
      }
    });
  });

  describe('prompt templates (regression for #643)', () => {
    // promptService substitutes only {{var}} and {{=json:var}}. Anything else
    // is passed to the model verbatim, so conditionals emitted both branches
    // and filter expressions arrived as raw Jinja.
    const dir = path.join(__dirname, '..', 'prompts');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));

    it('finds prompt files to check', () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('%s contains no unsupported template syntax', (file) => {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');

      expect(text).not.toMatch(/\{%/);
      // a pipe inside a placeholder is a filter expression
      expect(text).not.toMatch(/\{\{[^}]*\|/);
    });
  });
});
