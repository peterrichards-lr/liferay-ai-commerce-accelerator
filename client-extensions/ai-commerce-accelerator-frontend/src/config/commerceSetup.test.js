import {
  SELECTABLE_SITE_TYPES,
  catalogCurrency,
  catalogOptionLabel,
  findCatalog,
} from './commerceSetup';

/**
 * One resolver for "what is this run denominated in", so the card, the dialog
 * and the hook cannot disagree about it (#746).
 */
describe('commerceSetup', () => {
  const CATALOGS = [
    { id: 33941, name: 'Master', currencyCode: 'USD' },
    { id: 41002, name: 'Solara Moto', currencyCode: 'EUR' },
  ];

  describe('findCatalog', () => {
    it('matches across the string/number divide the config carries', () => {
      expect(findCatalog(CATALOGS, '41002')).toBe(CATALOGS[1]);
      expect(findCatalog(CATALOGS, 41002)).toBe(CATALOGS[1]);
    });

    it('answers null for a catalog the instance does not have', () => {
      expect(findCatalog(CATALOGS, 99999)).toBeNull();
    });

    it('answers null rather than a first entry when nothing is selected', () => {
      expect(findCatalog(CATALOGS, null)).toBeNull();
      expect(findCatalog(CATALOGS, '')).toBeNull();
    });

    it('survives a list that has not loaded', () => {
      expect(findCatalog(undefined, 41002)).toBeNull();
    });
  });

  describe('catalogCurrency', () => {
    it('reads the currency a catalog denominates', () => {
      expect(catalogCurrency(CATALOGS[1])).toBe('EUR');
    });

    // Empty has to stay distinguishable from a currency: it is what makes the
    // dialog refuse rather than reach for USD.
    it.each([
      ['absent', {}],
      ['null', { currencyCode: null }],
      ['whitespace', { currencyCode: '  ' }],
      ['no catalog', null],
    ])('answers empty when the currency is %s', (_label, catalog) => {
      expect(catalogCurrency(catalog)).toBe('');
    });
  });

  describe('catalogOptionLabel', () => {
    it('carries the currency, which is what the dropdown never showed', () => {
      expect(catalogOptionLabel(CATALOGS[0])).toBe('Master (USD)');
      expect(catalogOptionLabel(CATALOGS[1])).toBe('Solara Moto (EUR)');
    });

    it('falls back to the bare name rather than inventing a currency', () => {
      expect(catalogOptionLabel({ id: 1, name: 'Nameless Currency' })).toBe(
        'Nameless Currency'
      );
    });
  });

  // The numeric encoding belongs to the commerce-site-type module, not here -
  // `utils/channelSiteType.cjs` says so and it still holds. These are labels,
  // passed through and verified by reading back what the module reports.
  it('offers the three site types by label and encodes none of them', () => {
    expect(SELECTABLE_SITE_TYPES).toEqual(['B2C', 'B2B', 'B2X']);
    expect(SELECTABLE_SITE_TYPES.every((t) => Number.isNaN(Number(t)))).toBe(
      true
    );
  });
});
