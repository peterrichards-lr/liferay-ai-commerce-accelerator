/**
 * Representative render contexts for every prompt in `prompts/`.
 *
 * Each case mirrors the variable map `aiService` builds for that prompt at its
 * call site, including the composed blocks from `utils/promptContext.cjs`, so a
 * render here is the same render a generation performs. Two cases per prompt:
 * `rich`, with every optional block populated, and `bare`, with none of them,
 * which is the case that exercises the blank-line collapse.
 *
 * The rendered output of each case is committed under `prompt-corpus/` and
 * compared byte for byte by `promptRendering.test.cjs`. See that file for why.
 */

const {
  accountGeography,
  accountTypeGuidance,
  assignedNamesGuidance,
  avoidProductsGuidance,
  brandGuidance,
  currencyGuidance,
  languageGuidance,
  orderDateGuidance,
  vocabularyGuidance,
  warehouseGeography,
} = require('../../utils/promptContext.cjs');
const { pricingHints } = require('../../utils/promptHelpers.cjs');

const BRAND = 'A premium outdoor gear brand focusing on sustainability';

const GROUNDING = {
  currencies: [{ code: 'USD' }, { code: 'EUR' }],
  languages: [{ id: 'en_US' }, { id: 'fr_FR' }],
  vocabularies: [
    {
      categories: [{ name: 'Wrenches' }, { name: 'Drivers' }],
      name: 'Tool Type',
    },
  ],
};

const GEOGRAPHY = {
  countryISOCode: 'DE',
  countryTitle: 'Germany',
  regionISOCode: 'HH',
  regionTitle: 'Hamburg',
};

// `orderDateGuidance` reads the clock, so the corpus pins it. Everything else
// in these contexts is already deterministic.
const NOW = new Date('2026-01-15T09:30:00.000Z');

// Already a JSON string by the time it reaches the template, and the template
// then applies `{{=json:}}` to it - so the model receives a quoted, escaped
// JSON document. That double encoding is existing behaviour and the corpus
// pins it deliberately; see #655.
const PRODUCT_LIST_JSON = JSON.stringify(
  [
    { name: 'Trail Runner 5 Jacket', sku: 'TRJ-005' },
    { name: 'Summit 40L Pack', sku: 'SMP-040' },
  ],
  null,
  2
);

const ACCOUNT_LIST_JSON = JSON.stringify(
  [
    { id: 41301, name: 'Northwind Outfitters' },
    { id: 41302, name: 'Alpine Supply Co' },
  ],
  null,
  2
);

const SPECIFICATIONS_JSON = JSON.stringify(
  [
    { label: 'Material', value: 'Recycled polyester' },
    { label: 'Weight', value: '420 g' },
  ],
  null,
  2
);

const PRICE_ENTRIES_INSTRUCTION = `- priceEntries: array of price list entry objects, one per object in "skuVariants".
            - price (number): The unit price.
            - discountDiscovery (boolean): Always set to false.`;

const cases = [
  {
    label: 'rich',
    prompt: 'account',
    vars: {
      accountType: 'mixed',
      accountTypeGuidance: accountTypeGuidance({
        accountType: 'mixed',
        categories: 'Tools, Safety Equipment',
        count: 12,
        pluralSuffix: 's',
      }),
      brandGuidance: brandGuidance(
        BRAND,
        'These accounts are potential customers or business partners for this brand.'
      ),
      brandName: BRAND,
      categories: 'Tools, Safety Equipment',
      count: 12,
      geographicContext: GEOGRAPHY,
      groundingMetadata: GROUNDING,
      languageCodesCSV: 'en_US, fr_FR',
      languageGuidance: languageGuidance(GROUNDING),
      languageList: 'en_US, fr_FR',
      pluralSuffix: 's',
      ...accountGeography(GEOGRAPHY),
    },
  },
  {
    label: 'bare',
    prompt: 'account',
    vars: {
      accountType: 'business',
      accountTypeGuidance: accountTypeGuidance({
        accountType: 'business',
        categories: '',
        count: 1,
        pluralSuffix: '',
      }),
      brandGuidance: brandGuidance(
        '',
        'These accounts are potential customers or business partners for this brand.'
      ),
      brandName: '',
      categories: '',
      count: 1,
      geographicContext: null,
      groundingMetadata: null,
      languageCodesCSV: 'en_US',
      languageGuidance: languageGuidance(null),
      languageList: 'en_US',
      pluralSuffix: '',
      ...accountGeography(null),
    },
  },
  {
    label: 'rich',
    prompt: 'image',
    vars: {
      brandGuidance: `BRAND CONTEXT: ${BRAND}\n\nLet that shape the product's appearance, materials and finish.`,
      categoryGuidance:
        'The product is in the Outerwear category and should look plausible for it.',
      imageStyle: 'photographic',
      productName: 'Trail Runner 5 Jacket',
    },
  },
  {
    label: 'bare',
    prompt: 'image',
    vars: {
      brandGuidance:
        'The product must be generic and unbranded: no logos, no brand names.',
      categoryGuidance: '',
      imageStyle: 'photographic',
      productName: 'Trail Runner 5 Jacket',
    },
  },
  {
    label: 'rich',
    prompt: 'names',
    vars: {
      brandGuidance: brandGuidance(BRAND),
      categoryList: 'Tools, Safety Equipment',
      count: 8,
      pluralSuffix: 's',
      vocabularyGuidance: vocabularyGuidance(GROUNDING),
    },
  },
  {
    label: 'bare',
    prompt: 'names',
    vars: {
      brandGuidance: brandGuidance(''),
      categoryList: 'General',
      count: 1,
      pluralSuffix: '',
      vocabularyGuidance: vocabularyGuidance(null),
    },
  },
  {
    label: 'rich',
    prompt: 'order',
    vars: {
      accountListJSON: ACCOUNT_LIST_JSON,
      brandGuidance: brandGuidance(
        BRAND,
        'These orders represent business transactions with this brand.'
      ),
      brandName: BRAND,
      count: 25,
      groundingMetadata: GROUNDING,
      languageCodesCSV: 'en_US, fr_FR',
      languageGuidance: languageGuidance(GROUNDING),
      languageList: 'en_US, fr_FR',
      orderDateGuidance: orderDateGuidance(90, NOW),
      orderDateRangeDays: 90,
      pluralSuffix: 's',
      productListJSON: PRODUCT_LIST_JSON,
    },
  },
  {
    label: 'bare',
    prompt: 'order',
    vars: {
      accountListJSON: ACCOUNT_LIST_JSON,
      brandGuidance: brandGuidance(
        '',
        'These orders represent business transactions with this brand.'
      ),
      brandName: '',
      count: 1,
      groundingMetadata: null,
      languageCodesCSV: 'en_US',
      languageGuidance: languageGuidance(null),
      languageList: 'en_US',
      orderDateGuidance: orderDateGuidance(0, NOW),
      orderDateRangeDays: 0,
      pluralSuffix: '',
      productListJSON: PRODUCT_LIST_JSON,
    },
  },
  {
    label: 'rich',
    prompt: 'pdf',
    vars: {
      brandGuidance: brandGuidance(
        BRAND,
        "The generated document should reflect this brand's voice and style."
      ),
      brandName: BRAND,
      category: 'Outerwear',
      contentType: 'user_guide',
      contentTypeLabel: 'a step-by-step user guide',
      groundingMetadata: GROUNDING,
      productDescription: 'A three-layer shell for sustained wet weather.',
      productName: 'Trail Runner 5 Jacket',
      specificationsJSON: SPECIFICATIONS_JSON,
    },
  },
  {
    label: 'bare',
    prompt: 'pdf',
    vars: {
      brandGuidance: brandGuidance(
        '',
        "The generated document should reflect this brand's voice and style."
      ),
      brandName: '',
      category: 'Outerwear',
      contentType: 'product_info',
      contentTypeLabel: 'detailed product information',
      groundingMetadata: null,
      productDescription: 'A three-layer shell for sustained wet weather.',
      productName: 'Trail Runner 5 Jacket',
      specificationsJSON: JSON.stringify({}, null, 2),
    },
  },
  {
    label: 'rich',
    prompt: 'pricing',
    vars: {
      brandGuidance: brandGuidance(
        BRAND,
        'This price list is for products belonging to this brand.'
      ),
      brandName: BRAND,
      currencyGuidance: currencyGuidance(GROUNDING),
      groundingMetadata: GROUNDING,
      pricingType: 'bulk',
      productListJSON: PRODUCT_LIST_JSON,
      ...pricingHints('bulk'),
    },
  },
  {
    label: 'bare',
    prompt: 'pricing',
    vars: {
      brandGuidance: brandGuidance(
        '',
        'This price list is for products belonging to this brand.'
      ),
      brandName: '',
      currencyGuidance: currencyGuidance(null),
      groundingMetadata: null,
      pricingType: 'standard',
      productListJSON: PRODUCT_LIST_JSON,
      ...pricingHints('standard'),
    },
  },
  {
    label: 'tier',
    prompt: 'pricing',
    vars: {
      brandGuidance: brandGuidance(
        BRAND,
        'This price list is for products belonging to this brand.'
      ),
      brandName: BRAND,
      currencyGuidance: currencyGuidance(GROUNDING),
      groundingMetadata: GROUNDING,
      pricingType: 'tier',
      productListJSON: PRODUCT_LIST_JSON,
      ...pricingHints('tier'),
    },
  },
  {
    label: 'promotional',
    prompt: 'pricing',
    vars: {
      brandGuidance: brandGuidance(
        BRAND,
        'This price list is for products belonging to this brand.'
      ),
      brandName: BRAND,
      currencyGuidance: currencyGuidance(GROUNDING),
      groundingMetadata: GROUNDING,
      pricingType: 'promotional',
      productListJSON: PRODUCT_LIST_JSON,
      ...pricingHints('promotional'),
    },
  },
  {
    label: 'rich',
    prompt: 'product',
    vars: {
      assignedNamesGuidance: assignedNamesGuidance([
        'Trail Runner 5 Jacket',
        'Summit 40L Pack',
      ]),
      avoidProductsGuidance: '',
      brandGuidance: brandGuidance(BRAND),
      brandName: BRAND,
      category: 'Outerwear',
      count: 2,
      currencyGuidance: currencyGuidance(GROUNDING),
      groundingMetadata: GROUNDING,
      languageCodesCSV: 'en_US, fr_FR',
      languageCodesNamePairs:
        '"en_US": "translated name", "fr_FR": "translated name"',
      languageGuidance: languageGuidance(GROUNDING),
      languageList: 'en_US, fr_FR',
      pluralSuffix: 's',
      priceEntriesInstruction: PRICE_ENTRIES_INSTRUCTION,
      vocabularyGuidance: vocabularyGuidance(GROUNDING),
    },
  },
  {
    label: 'bare',
    prompt: 'product',
    vars: {
      assignedNamesGuidance: assignedNamesGuidance([]),
      avoidProductsGuidance: avoidProductsGuidance(null),
      brandGuidance: brandGuidance(''),
      brandName: '',
      category: 'Outerwear',
      count: 1,
      currencyGuidance: currencyGuidance(null),
      groundingMetadata: null,
      languageCodesCSV: 'en_US',
      languageCodesNamePairs: '"en_US": "translated name"',
      languageGuidance: languageGuidance(null),
      languageList: 'en_US',
      pluralSuffix: '',
      priceEntriesInstruction: '',
      vocabularyGuidance: vocabularyGuidance(null),
    },
  },
  {
    label: 'avoid-list',
    prompt: 'product',
    vars: {
      assignedNamesGuidance: assignedNamesGuidance([]),
      avoidProductsGuidance: avoidProductsGuidance({
        baseSkus: ['TRJ-005'],
        names: ['Trail Runner 5 Jacket'],
      }),
      brandGuidance: brandGuidance(BRAND),
      brandName: BRAND,
      category: 'Outerwear',
      count: 10,
      currencyGuidance: currencyGuidance(GROUNDING),
      groundingMetadata: GROUNDING,
      languageCodesCSV: 'en_US, fr_FR',
      languageCodesNamePairs:
        '"en_US": "translated name", "fr_FR": "translated name"',
      languageGuidance: languageGuidance(GROUNDING),
      languageList: 'en_US, fr_FR',
      pluralSuffix: 's',
      priceEntriesInstruction: PRICE_ENTRIES_INSTRUCTION,
      vocabularyGuidance: vocabularyGuidance(GROUNDING),
    },
  },
  {
    label: 'rich',
    prompt: 'promo',
    vars: {
      accountListJSON: ACCOUNT_LIST_JSON,
      brandGuidance: brandGuidance(
        BRAND,
        'Ensure segment descriptions, promotion names and targeting logic reflect this brand.'
      ),
      brandName: BRAND,
      productListJSON: PRODUCT_LIST_JSON,
    },
  },
  {
    label: 'bare',
    prompt: 'promo',
    vars: {
      accountListJSON: ACCOUNT_LIST_JSON,
      brandGuidance: brandGuidance(
        '',
        'Ensure segment descriptions, promotion names and targeting logic reflect this brand.'
      ),
      brandName: '',
      productListJSON: PRODUCT_LIST_JSON,
    },
  },
  {
    label: 'rich',
    prompt: 'warehouse',
    vars: {
      brandName: BRAND,
      count: 6,
      geographicContext: GEOGRAPHY,
      groundingMetadata: GROUNDING,
      languageCodesCSV: 'en_US, fr_FR',
      languageGuidance: languageGuidance(GROUNDING),
      languageList: 'en_US, fr_FR',
      pluralSuffix: 's',
      ...warehouseGeography(GEOGRAPHY),
    },
  },
  {
    label: 'bare',
    prompt: 'warehouse',
    vars: {
      brandName: '',
      count: 1,
      geographicContext: null,
      groundingMetadata: null,
      languageCodesCSV: 'en_US',
      languageGuidance: languageGuidance(null),
      languageList: 'en_US',
      pluralSuffix: '',
      ...warehouseGeography(null),
    },
  },
];

module.exports = { cases };
