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
function brandGuidance(brandContext) {
  const context = String(brandContext || '').trim();

  if (!context) {
    return '';
  }

  return (
    `BRAND CONTEXT: ${context}\n\n` +
    'Ensure product names, descriptions, marketing copy and specifications ' +
    'reflect this brand and its tone.'
  );
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

module.exports = {
  brandGuidance,
  currencyGuidance,
  vocabularyGuidance,
};
