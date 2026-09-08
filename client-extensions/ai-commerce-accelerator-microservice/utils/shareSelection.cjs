/**
 * How a "ratio" option turns into a share of a population.
 *
 * Every ratio in this codebase answers the same question - what portion of the
 * products, or of the accounts, should carry this attribute - and before #729
 * each one answered it differently:
 *
 * - `imageRatio` and `pdfRatio` took an exact count but shuffled with
 *   `sort(() => Math.random() - 0.5)`, so the same dataset could not be
 *   regenerated twice.
 * - `inventoryAssignmentRatio` rolled a die per product, so even the *count*
 *   varied - at 50% over 50 products, anywhere from roughly 18 to 32.
 * - `businessAccountRatio` was a fraction (0-1) while the rest were
 *   percentages (0-100). That is the condition that produced #711, where a
 *   1.0 meaning "all" was read as 1%.
 *
 * One unit and one selection rule for all of them.
 */

// Percentages, everywhere. See toPercentage for how a legacy fraction is taken.
const RATIO_MIN = 0;
const RATIO_MAX = 100;

/**
 * Names the attribute a share is being drawn for.
 *
 * The key is mixed into the hash, which is what keeps the shares independent:
 * without it every ratio would draw from the same ordering and the same
 * products would carry the images, the PDFs, the inventory and the backorder
 * flag, leaving the rest of the catalogue inert.
 */
const SELECTION_KEYS = {
  BACKORDER: 'backorder',
  IMAGES: 'images',
  INVENTORY: 'inventory',
  PDFS: 'pdfs',
};

/**
 * FNV-1a, 32-bit.
 *
 * Needs to be stable across processes and well distributed; it does not need
 * to be cryptographic. Deliberately not a seeded RNG - the point of #729 is
 * that the same inputs give the same dataset, and a generator carrying state
 * between calls would make the result depend on call order.
 */
function hash32(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/**
 * Clamps rather than rejecting.
 *
 * `selectProductsForImages` used to `return []` for anything above 100, so a
 * 150 generated no images at all instead of all of them - a silent nothing in
 * place of an obvious everything.
 */
function clampRatio(ratio) {
  const numeric = Number(ratio);

  if (!Number.isFinite(numeric)) {
    return RATIO_MIN;
  }

  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, numeric));
}

/**
 * Reads a ratio as a percentage, tolerating a fraction rather than silently
 * thinning the set.
 *
 * #711 was a 1.0 that meant "everything" and selected 1%. Nothing warned. A
 * value below 1 is therefore treated as the fraction it almost certainly is,
 * loudly, rather than acted on.
 *
 * `legacyFraction` is for `businessAccountRatio`, whose stored format *was*
 * 0-1 with 1 meaning all. For that field alone a stored 1 means 100%; for a
 * percentage-native field 1 legitimately means 1%, so the boundary differs and
 * the caller has to say which it is holding.
 */
function toPercentage(
  value,
  { field = 'ratio', legacyFraction = false, logger } = {}
) {
  // `Number(null)` and `Number('')` are both 0, so an empty field would come
  // through as "0% business" - every account an individual - rather than
  // "unspecified". `businessAccountRatio` has to stay undefined when absent so
  // the prompt's own mixed branch keeps deciding the split.
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const isFraction = legacyFraction
    ? numeric > 0 && numeric <= 1
    : numeric > 0 && numeric < 1;

  if (isFraction) {
    const asPercentage = numeric * 100;

    logger?.warn?.(
      `${field} was ${numeric}, which reads as a fraction on a 0-100 scale. ` +
        `Taking it as ${asPercentage}%. Pass a percentage to remove this warning.`
    );

    return clampRatio(asPercentage);
  }

  return clampRatio(numeric);
}

/**
 * How many of `total` a ratio covers.
 *
 * Shared with the account split so the two can never disagree about what a
 * ratio of a total means. `aiService` splits the requested account count once,
 * before chunking, precisely so the rounding happens a single time; this is
 * that arithmetic, named.
 */
function shareCount(total, ratio) {
  const size = Number(total);

  if (!Number.isFinite(size) || size <= 0) {
    return 0;
  }

  return Math.round(size * (clampRatio(ratio) / 100));
}

/**
 * The share of `items` that should carry `selectionKey`.
 *
 * Exact count, independent per attribute, spread across the whole population,
 * and reproducible. Ordering is by `hash(identity + selectionKey + ratio)`:
 *
 * - keying on the item's own identity rather than its index means a reordered
 *   list selects the same items;
 * - mixing in `selectionKey` decorrelates the attributes from one another;
 * - mixing in `ratio` means a 50% share and a 60% share of the same attribute
 *   are independent samples rather than one nested inside the other.
 *
 * Returns the selection in the original list order, so callers that iterate it
 * see the sequence they passed in.
 */
function selectShare(items, ratio, selectionKey, { identityOf, logger } = {}) {
  const list = Array.isArray(items) ? items : [];
  const percentage = clampRatio(ratio);
  const count = shareCount(list.length, percentage);

  if (count <= 0) {
    return [];
  }

  if (count >= list.length) {
    return [...list];
  }

  const identify = identityOf || ((item) => item?.externalReferenceCode);

  let missingIdentity = false;

  const ranked = list.map((item, index) => {
    let identity = identify(item);

    if (typeof identity !== 'string' || !identity) {
      // Falling back to the index restores the order-dependence this function
      // exists to remove, so it is worth a warning rather than a silent
      // substitution.
      missingIdentity = true;
      identity = `index:${index}`;
    }

    return {
      index,
      item,
      // The ratio is part of the key, so raising it reshuffles rather than
      // extends. Separators keep 'a' + 'bc' from colliding with 'ab' + 'c'.
      rank: hash32(`${identity} ${selectionKey} ${percentage}`),
    };
  });

  if (missingIdentity) {
    logger?.warn?.(
      `selectShare(${selectionKey}) found items without an ` +
        'externalReferenceCode and fell back to their position, which makes ' +
        'the share depend on list order.'
    );
  }

  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);

  const selected = new Set(ranked.slice(0, count).map((entry) => entry.index));

  return list.filter((_item, index) => selected.has(index));
}

module.exports = {
  RATIO_MAX,
  RATIO_MIN,
  SELECTION_KEYS,
  clampRatio,
  selectShare,
  shareCount,
  toPercentage,
};
