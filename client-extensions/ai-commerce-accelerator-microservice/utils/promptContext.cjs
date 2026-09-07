/**
 * Optional prompt blocks, composed here rather than branched in a template.
 *
 * promptService substitutes only `{{var}}` and `{{=json:var}}` - there is no
 * conditional, no loop and no filter. Every prompt file was nonetheless written
 * against Jinja2, so `{% if %}`, `{% for %}` and `{{ x | map(...) }}` pass
 * through unexpanded into the text sent to the model. See #643.
 *
 * The consequences are worse than untidy. Both branches of every conditional
 * fire, so a run with no brand configured still told the model the products
 * belong to `the brand/company ""`. And a loop that never expands leaves its
 * instruction standing with nothing behind it: the product prompt says "You
 * MUST categorize these products using the following existing Liferay
 * vocabularies" and then lists none.
 *
 * Each function returns the finished text or an empty string, so a template
 * needs only a plain placeholder and the decision lives in code that can be
 * tested.
 */

/**
 * The brand block.
 *
 * The field is free text - labelled "Brand / Context" in the UI, with the
 * placeholder "A premium outdoor gear brand focusing on sustainability" - so it
 * may be a description rather than a name. The existing prompts render it as
 * `the brand/company "{{brandName}}"`, which reads oddly for a sentence, so it
 * is presented as context instead of quoted as a name.
 */
const PRODUCT_BRAND_FOLLOW_UP =
  'Ensure product names, descriptions, marketing copy and specifications ' +
  'reflect this brand and its tone.';

function brandGuidance(brandContext, followUp = PRODUCT_BRAND_FOLLOW_UP) {
  const context = String(brandContext || '').trim();

  if (!context) {
    return '';
  }

  const trailer = String(followUp || '').trim();

  return trailer
    ? `BRAND CONTEXT: ${context}\n\n${trailer}`
    : `BRAND CONTEXT: ${context}`;
}

/**
 * The Liferay vocabulary block, listing what the products must be categorised
 * against.
 *
 * Returns nothing when there are no vocabularies, which is the case the broken
 * conditional could not express - and the one that matters, because a
 * mandatory instruction with no data behind it is worse than no instruction.
 */
function vocabularyGuidance(groundingMetadata) {
  const vocabularies = groundingMetadata?.vocabularies;

  if (!Array.isArray(vocabularies) || vocabularies.length === 0) {
    return '';
  }

  const lines = vocabularies
    .map((vocabulary) => {
      const categories = (vocabulary?.categories || [])
        .map((category) => category?.name)
        .filter(Boolean);

      if (!vocabulary?.name || categories.length === 0) {
        return null;
      }

      return `- Vocabulary "${vocabulary.name}": ${categories.join(', ')}`;
    })
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  return (
    'LIFERAY CONTEXT: You MUST categorize these products using the following ' +
    `existing Liferay vocabularies and categories:\n\n${lines.join('\n')}`
  );
}

/**
 * The currency block. Prices in a currency the instance does not have active
 * cannot be imported, so this is worth stating when it is known.
 */
function currencyGuidance(groundingMetadata) {
  const codes = (groundingMetadata?.currencies || [])
    .map((currency) => currency?.code)
    .filter(Boolean);

  if (codes.length === 0) {
    return '';
  }

  return (
    'LIFERAY CONTEXT: When generating prices, use one of the following active ' +
    `currencies: ${codes.join(', ')}.`
  );
}

/**
 * The active-language block.
 *
 * The templates wrote this as `{{ groundingMetadata.languages |
 * map(attribute='id') | join(', ') }}`. The renderer's placeholder pattern is
 * `[\w.[\]]+`, which cannot match spaces or pipes, so the whole expression was
 * passed to the model verbatim.
 */
function languageGuidance(groundingMetadata) {
  const ids = (groundingMetadata?.languages || [])
    .map((language) => language?.id)
    .filter(Boolean);

  if (ids.length === 0) {
    return '';
  }

  return (
    'LIFERAY CONTEXT: You MUST only use the following active Liferay ' +
    `languages for any multilingual fields: ${ids.join(', ')}.`
  );
}

/**
 * Warehouse geography.
 *
 * With a geographic context the model must reuse exact codes; without one it
 * has to invent well-formed ones. The template asked for both at once.
 */
function warehouseGeography(geographicContext) {
  const geo = geographicContext || null;

  if (!geo) {
    return {
      countryInstruction:
        'The two-letter ISO country code. MUST be exactly 2 uppercase ' +
        'letters (e.g., US, FR, JP).',
      regionInstruction:
        'The two-letter region or state code. MUST be exactly 2 uppercase ' +
        'letters (e.g., CA, NY, LD). If no standard 2-letter code exists, ' +
        'provide a plausible 2-letter uppercase abbreviation.',
      cityInstruction: 'A city where the warehouse is located.',
      geographyCritical:
        "CRITICAL: The 'country' and 'region' fields MUST be exactly 2 " +
        'uppercase letters. Failure to follow this format will break the ' +
        'system.',
    };
  }

  return {
    countryInstruction: String(geo.countryISOCode || ''),
    regionInstruction: String(geo.regionISOCode || ''),
    cityInstruction: `A city within ${geo.regionTitle}, ${geo.countryTitle}.`,
    geographyCritical:
      `CRITICAL: The 'country' MUST be "${geo.countryISOCode}" and the ` +
      `'region' MUST be "${geo.regionISOCode}". Use these EXACT values.`,
  };
}

/**
 * Account head-office geography. The region line is omitted entirely when no
 * region is known, rather than emitted with an empty value.
 */
function accountGeography(geographicContext) {
  const geo = geographicContext || null;

  if (!geo) {
    return {
      countryInstruction:
        'Choose from the following list of countries: United States, ' +
        'United Kingdom, France, Germany, Australia, Japan, Brazil, India, ' +
        'Canada, Mexico, South Africa, United Arab Emirates, Singapore',
      regionLine: '',
    };
  }

  return {
    countryInstruction: String(geo.countryTitle || ''),
    // Carries its own leading newline: the template appends it directly to
    // the country line so an absent region leaves no blank line mid-list.
    regionLine: geo.regionTitle
      ? `\n- headOfficeAddress.addressRegion: ${geo.regionTitle}`
      : '',
  };
}

/**
 * The account-type block, including the field descriptions that differ per
 * type. The template's three-way `{% if %}/{% elif %}/{% else %}` emitted all
 * three at once, so the model was told every account must be a person, and a
 * mix, and every account must be a business.
 */
function accountTypeGuidance({
  accountType,
  count,
  pluralSuffix = '',
  categories = '',
} = {}) {
  const type = String(accountType || 'business').toLowerCase();

  if (type === 'person') {
    return [
      'ACCOUNT TYPE: Every account must be an individual/consumer account. ' +
        'Set "type" to "person" for all accounts.',
      '',
      "- name: The individual's full name (string, required), relevant to " +
        `the following context: ${categories}.`,
      '- emailAddress: A personal email address for that individual, e.g. ' +
        'firstname.lastname@example.com (string, optional)',
      '- taxId: Omit this field for person accounts; do not include it.',
    ].join('\n');
  }

  if (type === 'mixed') {
    return [
      'ACCOUNT TYPE: Generate a realistic mix of both "business" and ' +
        `"person" accounts across the ${count} account${pluralSuffix} ` +
        '(roughly half of each, unless the context below suggests a ' +
        'different split). For "business" accounts, use a company name and ' +
        'set "type" to "business". For "person" accounts, use an ' +
        'individual\'s full name and set "type" to "person"; omit ' +
        '"taxId" for these.',
      '',
      '- name: Company name for "business" accounts, or the individual\'s ' +
        'full name for "person" accounts (string, required). Business names ' +
        `should be relevant to the following business categories: ${categories}.`,
      '- emailAddress: Company email for "business" accounts, or a personal ' +
        'email for "person" accounts (string, optional)',
      '- taxId: Realistic tax ID format, only for "business" accounts ' +
        '(string, optional)',
    ].join('\n');
  }

  return [
    'ACCOUNT TYPE: Every account must be a business account. Set "type" to ' +
      '"business" for all accounts.',
    '',
    '- name: Company name (string, required). The company names should be ' +
      `relevant to the following business categories: ${categories}.`,
    '- emailAddress: Company email (string, optional)',
    '- taxId: Realistic tax ID format (string, optional)',
  ].join('\n');
}

/**
 * The order-date block. Without a range the model is told to use the current
 * date; with one it is asked to spread dates and include reorders.
 */
function orderDateGuidance(orderDateRangeDays, now = new Date()) {
  const days = Number(orderDateRangeDays) || 0;
  const today = now.toISOString().slice(0, 10);

  if (days <= 0) {
    return (
      '- orderDate (ISO 8601 date-time string). Use the current date/time ' +
      `for all orders. Today is ${today}.`
    );
  }

  // The model has no idea what "now" is: asked for "the last 90 days" it has
  // been observed returning 2023 dates. State the window explicitly.
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return [
    '- orderDate (ISO 8601 date-time string). Distribute order dates ' +
      `realistically across the last ${days} days - that is, between ` +
      `${from} and ${today} inclusive, and never outside that window - ` +
      'rather than clustering them all on the same date. Older ' +
      'orders should skew toward earlier in that window and more recent ' +
      'activity toward the end, so the set reads as genuine order history ' +
      'over time.',
    '',
    'REORDER PATTERNS: Some accounts should place more than one order across ' +
      'this date range (a "reorder"), each dated later than the previous one ' +
      'for that same account, often repeating one or more of the same items. ' +
      'Not every account needs a reorder, but the overall set should include ' +
      'a believable mix of first-time and repeat purchasers rather than ' +
      'every account ordering exactly once.',
  ].join('\n');
}

module.exports = {
  accountGeography,
  accountTypeGuidance,
  brandGuidance,
  currencyGuidance,
  languageGuidance,
  orderDateGuidance,
  vocabularyGuidance,
  warehouseGeography,
};
