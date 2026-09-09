/**
 * The first street line of a generated postal address.
 *
 * The model already returns one on every address it generates, and the account
 * generator used to throw it away and put `randomString(8)` in its place - so a
 * demo screen showed "822 fiiqbmgf Road, London, W1D 3QJ", eight random letters
 * beside a real postcode. Everything around it was plausible, which made the
 * one synthetic field more conspicuous rather than less, and this was the live
 * path: `_generateAddress` runs for head office, billing and shipping with no
 * demoMode gate (#826).
 *
 * Keeping the model's line also keeps the street consistent with the city and
 * postcode the same response chose, which no locally generated name can be.
 */

/**
 * Names for the case where the model supplied nothing.
 *
 * Deliberately locale-neutral - civic and botanical names that read as ordinary
 * in the English-speaking locales this generates for - because the fallback
 * fires precisely when there is no country context to key a list off. Per
 * country lists are the second option in #826 and remain open; this replaces
 * random letters, which was the defect.
 */
const STREET_NAMES = [
  'Ash',
  'Birch',
  'Bridge',
  'Castle',
  'Cedar',
  'Chapel',
  'Church',
  'Elm',
  'Fountain',
  'Garden',
  'Grange',
  'Hawthorn',
  'Hillside',
  'Holly',
  'Juniper',
  'Laurel',
  'Maple',
  'Market',
  'Meadow',
  'Mill',
  'Oak',
  'Orchard',
  'Poplar',
  'Quarry',
  'Riverside',
  'Spring',
  'Station',
  'Sycamore',
  'Union',
  'Vine',
  'Willow',
];

const STREET_TYPES = ['Street', 'Avenue', 'Road', 'Lane'];

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

/** A house number, a name and a street type, e.g. "822 Camden Road". */
function syntheticStreetLine() {
  const streetNumber = Math.floor(Math.random() * 999) + 1;

  return `${streetNumber} ${pick(STREET_NAMES)} ${pick(STREET_TYPES)}`;
}

/**
 * The model's street line when it supplied one, a synthetic line otherwise.
 *
 * Whitespace counts as absent: a model that returns `""` or `"  "` has not
 * named a street, and an address with a blank first line is worse on screen
 * than an invented one.
 */
function streetLine(address) {
  const supplied =
    typeof address?.streetAddressLine1 === 'string'
      ? address.streetAddressLine1.trim()
      : '';

  return supplied || syntheticStreetLine();
}

module.exports = {
  STREET_NAMES,
  STREET_TYPES,
  streetLine,
  syntheticStreetLine,
};
