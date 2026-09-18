/**
 * Which parts of the Data Generator form a run's volumes make relevant, and
 * what a run submits for the parts the form never showed.
 *
 * Rendering and submission read the same rules from here so the two cannot
 * drift. A section the operator was never shown is a section whose settings
 * the request does not carry, which is the only way the form can be trusted
 * to describe the run it starts. See #677.
 */

const toCount = (value) => {
  const count = Number.parseInt(value, 10);

  return Number.isNaN(count) ? 0 : count;
};

/**
 * The fields each section owns.
 *
 * The three volume inputs are deliberately absent: they are what makes a
 * section appear, so no section may own one. A section that could hide the
 * count driving it would be a door that locks from the inside.
 */
export const SECTION_FIELDS = {
  products: [
    'generateSpecifications',
    'generateSkuVariants',
    'generatePriceLists',
    'generateBulkPricing',
    'generateTierPricing',
    'generatePromotions',
    'imageMode',
    'imageRatio',
    'imageStyle',
    'customImageFile',
    'pdfMode',
    'pdfRatio',
    'pdfContentType',
    'customPDFFile',
    'createWarehouses',
    'reuseExistingWarehouses',
    'warehouseCount',
    'inventoryMin',
    'inventoryMax',
    'inventoryAssignmentRatio',
    'enableBackorders',
    'backorderAssignmentRatio',
  ],
  accounts: ['accountType', 'businessAccountRatio'],
  orders: ['orderDateRangeDays', 'orderDistribution'],
  categories: ['categories'],
  orderAccountType: ['orderAccountType'],
};

/**
 * Which sections a config makes relevant.
 *
 * `categories` and `orderAccountType` are sections of one field each rather
 * than members of a bigger one, because neither follows a single count.
 */
export function sectionVisibility(generationConfig = {}) {
  const products = toCount(generationConfig.productCount) > 0;
  const accounts = toCount(generationConfig.accountCount) > 0;
  const orders = toCount(generationConfig.orderCount) > 0;

  return {
    products,
    accounts,
    orders,
    // Chosen category names are the thematic context for account generation
    // as well as product generation - the microservice feeds them to
    // `accountTypeGuidance` so company names suit the catalogue - which is
    // why the "pick at least one" rule already fires for either count.
    categories: products || accounts,
    // Order account type narrows which *existing* accounts may receive
    // orders, and `orderGenerator` only looks at it when the run created no
    // accounts of its own. A run that creates accounts gives its orders to
    // those, so the field governs nothing and is not asked for.
    orderAccountType: orders && !accounts,
  };
}

/**
 * The config to submit: every field belonging to a section the form did not
 * show is dropped.
 *
 * Dropped rather than reset, and dropped on submit rather than cleared from
 * state. Dropping keeps the request describing only what the operator was
 * actually asked. Leaving component state alone means a count taken to 0 and
 * back brings the settings that were already there back with it, rather than
 * silently returning them to defaults.
 *
 * Setting `undefined` rather than deleting the key is load-bearing:
 * `useGeneration` builds the request as `{ ...generationConfig, ...finalConfig }`,
 * so a key merely absent from the submitted config is re-supplied from state
 * and only an explicit `undefined` overrides it. `JSON.stringify` then drops
 * it, so the microservice receives no key at all.
 */
export function withHiddenSectionsDropped(generationConfig = {}) {
  // A seed pack replaces the volume-driven form with a fixed dataset whose
  // contents these counts do not describe. Nothing is hidden by a count, so
  // nothing is dropped.
  if (generationConfig.seedPack) {
    return { ...generationConfig };
  }

  const visible = sectionVisibility(generationConfig);

  const hidden = Object.entries(SECTION_FIELDS)
    .filter(([section]) => !visible[section])
    .flatMap(([, fields]) => fields);

  return {
    ...generationConfig,
    ...Object.fromEntries(hidden.map((field) => [field, undefined])),
  };
}
