/**
 * The catalog owns the currency.
 *
 * AICA writes its price lists into the *catalog*, denominated by
 * `config.currencyCode` (`generators/product-steps/pricing.cjs:620,643,661`).
 * Until #746 the channel supplied that number and the catalog received the
 * rows, so a EUR channel selected against the USD `Master` catalog produced
 * euro price lists inside a dollar catalog - and nothing on screen showed the
 * catalog's currency at all.
 *
 * One resolver, used by the Commerce card, the setup dialog and the hook, so
 * there is exactly one answer to "what is this run denominated in" rather than
 * three that can disagree.
 */

/**
 * The commerce site types a channel can be created as.
 *
 * Labels only, deliberately. `utils/channelSiteType.cjs` states that the
 * numeric encoding belongs to the commerce-site-type module rather than to this
 * repo, and it still does: these are passed through to the module untouched and
 * verified by reading back what it reports.
 */
export const SELECTABLE_SITE_TYPES = ['B2C', 'B2B', 'B2X'];

/**
 * The catalog a configuration names, or null when the list does not hold it -
 * mid-refresh, or after an import naming a catalog this instance never had.
 */
export function findCatalog(catalogs, catalogId) {
  if (!catalogId) return null;

  return (
    (catalogs || []).find((c) => String(c.id) === String(catalogId)) || null
  );
}

/**
 * The currency a catalog denominates, or `''` when it reports none.
 *
 * Empty is a real answer and must stay distinguishable from a currency: it is
 * what makes the dialog refuse rather than reach for USD (#1014).
 */
export function catalogCurrency(catalog) {
  return String(catalog?.currencyCode ?? '').trim();
}

/**
 * The catalog dropdown's label, carrying the currency.
 *
 * This is the value that decides what every generated price means, and it was
 * the one thing the dropdown did not show (#746).
 */
export function catalogOptionLabel(catalog) {
  const currency = catalogCurrency(catalog);

  return currency ? `${catalog.name} (${currency})` : catalog?.name;
}
