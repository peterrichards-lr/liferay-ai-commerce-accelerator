const { buildStableERC } = require('./misc.cjs');
const { orderableSkusFor } = require('./orderableSkus.cjs');

/**
 * Makes a product's price entries name exactly the SKUs Liferay will create -
 * one entry per orderable SKU, each carrying the whole of the decoration the
 * model put on any of them.
 *
 * `mockDataGenerator.generatePriceEntries` builds that set directly, so the
 * demo path cannot break the rule (#782). The AI path can and does: the model
 * is asked for `priceEntries` alongside `skuVariants` and routinely returns a
 * single entry against `baseSku`. Liferay creates no base SKU for a product
 * with SKU-contributing options - `skus.cjs` replaces `lp.skus` with the
 * variants - so that entry has no id for `pricing.cjs` to resolve and is
 * refused. A fifty-product live run logged 25 `Skipping price entry for SKU X`
 * warnings, and Pricing v2.0 fails a whole batch on one bad id, so refusing is
 * the only safe thing pricing.cjs can do. See #787.
 *
 * Deriving the missing entries is what `pricing.cjs` already tried to do, but
 * it hard-coded `tierPrices: []`, and the tier step selects candidates by
 * `tierPrices` being non-empty - so the tiers rode on the one entry that was
 * then refused and ticking Bulk or Tier Pricing produced nothing at all. The
 * option is asked for against a *product*, not a SKU, so every orderable SKU
 * of that product carries it.
 *
 * Tier external reference codes are re-keyed per SKU for a harder reason than
 * tidiness. `addOrUpdateCommerceTierPriceEntry`, in
 * `CommerceTierPriceEntryLocalServiceImpl`, resolves an incoming tier by
 * `fetchByERC_C(erc, companyId)` - company-wide, not within the price entry -
 * and updates the row it finds without moving it to the price entry it arrived
 * under. Nine variants sharing one ERC leave a single tier row hanging off
 * whichever variant reached Liferay first, holding the last price written, and
 * report no error at all.
 *
 * This enforces the rule rather than trusting `prompts/product.md` to state it,
 * the way `optionValueCoverage` does for option values (#754). The prompt says
 * it too, so a compliant model needs no correction; a model that ignores it
 * still produces a priceable catalogue.
 */

/**
 * Liferay rejects a price entry of zero, and the derivation can produce one
 * from a -100% modifier or a template price of nothing.
 */
const MINIMUM_PRICE = 0.01;

function skuCodesOf(sku) {
  return [sku?.externalReferenceCode, sku?.sku].filter(
    (code) => typeof code === 'string' && code.length > 0
  );
}

/**
 * The SKUs of one product that Liferay will hold a price against.
 *
 * `orderableSkusFor` answers this for a run that creates variants, and reads
 * the product alone: SKU-contributing options mean the base SKU is not created,
 * so the variants are the only thing an order - or a price entry - may name.
 *
 * A run with `generateSkuVariants` off is the exception, and the product cannot
 * express it. `products.cjs` omits the base SKU only when variants are being
 * created, and `skus.cjs` replaces `lp.skus` with the variants under the same
 * condition, so that run creates the base SKU and nothing else - while the
 * model returns `skuVariants` and `skuContributor` regardless, because
 * `prompts/product.md` asks for them unconditionally. Consulting the product
 * alone would drop the base entry, which is the only one with an id, and derive
 * entries for variants Liferay never created: a priced product would reach the
 * storefront with no price at all.
 */
function priceableSkusFor(product, variants) {
  if (variants) {
    return orderableSkusFor(product);
  }

  return (product?.skus || []).filter((sku) => skuCodesOf(sku).length > 0);
}

/**
 * The code an entry names its SKU by. `sku` is accepted as well as
 * `skuExternalReferenceCode` because `pricing.cjs` resolves the physical id
 * from either, so an entry using it is a real entry rather than a stray.
 */
function entrySkuCodeOf(entry) {
  const named =
    entry?.skuExternalReferenceCode ||
    (typeof entry?.sku === 'string' ? entry.sku : '');

  return typeof named === 'string' ? named : '';
}

function modifierOf(sku) {
  return typeof sku?.priceModifier === 'number' ? sku.priceModifier : 0;
}

/**
 * A price moved from one variant's modifier to another's.
 *
 * The template is usually the base entry, whose modifier is zero, and this is
 * then the `price * (1 + modifier)` the pricing step always applied. It matters
 * when the model returned only a variant's entry: applying the new variant's
 * modifier to an already-modified price compounds the two, so a -15% entry
 * would seed the whole product at a discount. Undefined rather than a fallback
 * for a value that is not a usable price, so a caller can tell the difference.
 */
function rescale(value, fromModifier, toModifier) {
  const price = Number(value);

  if (!Number.isFinite(price) || price <= 0) {
    return undefined;
  }

  const from = 1 + fromModifier;
  const factor = from > 0 ? (1 + toModifier) / from : 1 + toModifier;
  const rescaled = Number((price * factor).toFixed(2));

  return rescaled > 0 ? rescaled : undefined;
}

/**
 * A SKU that states its own price states it absolutely, so it is taken as it
 * stands rather than derived - the rule `generatePriceEntries` follows.
 */
function statedPrice(sku) {
  const price = Number(sku?.price);

  return Number.isFinite(price) && price > 0
    ? Number(price.toFixed(2))
    : undefined;
}

/**
 * The entry every missing one is derived from.
 *
 * The base entry first, because it is the one the model decorates and the one
 * that cannot be sent, then whatever arrived first - a product whose entries
 * are all for variants still has a donor for the variants it missed.
 */
function templateEntry(product, entries) {
  const baseCodes = new Set(
    [
      product?.baseSku,
      product?.externalReferenceCode,
      product?.skus?.[0]?.sku,
      product?.skus?.[0]?.externalReferenceCode,
    ].filter(Boolean)
  );

  return (
    entries.find((entry) => baseCodes.has(entrySkuCodeOf(entry))) || entries[0]
  );
}

function derivedEntry(template, templateModifier, sku, code) {
  const modifier = modifierOf(sku);
  const priceListERC = template.priceListExternalReferenceCode;
  const price =
    statedPrice(sku) ??
    rescale(template.price, templateModifier, modifier) ??
    MINIMUM_PRICE;
  const promoPrice = rescale(template.promoPrice, templateModifier, modifier);

  const entry = {
    ...template,
    externalReferenceCode: buildStableERC('PE', [code, priceListERC]),
    price,
    promoPrice,
    skuExternalReferenceCode: code,
  };

  if (Array.isArray(template.tierPrices) && template.tierPrices.length > 0) {
    entry.tierPrices = template.tierPrices.map((tier) => ({
      ...tier,
      externalReferenceCode: buildStableERC('TP', [
        code,
        priceListERC,
        String(tier?.minimumQuantity),
      ]),
      price: rescale(tier?.price, templateModifier, modifier) ?? MINIMUM_PRICE,
    }));
  }

  return entry;
}

/**
 * A tier nothing will file is worse than no tier at all.
 *
 * `productSubflow.pricingSteps` adds create-bulk-pricing and
 * create-tier-pricing only when their option is ticked, and
 * `runGeneratePriceListsStep` selects `!bulkPricing && no tierPrices` - so a
 * decorated entry in a price-lists-only run is filed by no step that runs, and
 * the product reaches the storefront with no price. The prompt asks for tiers
 * only when they were ticked, but the generation schema permits them either
 * way and a model that volunteers them must not cost the product its price.
 */
function stripUnaskedDecoration(entry) {
  if (!entry.bulkPricing && (entry.tierPrices || []).length === 0) {
    return entry;
  }

  const {
    bulkPricing: _bulkPricing,
    tierPrices: _tierPrices,
    ...plain
  } = entry;

  return plain;
}

/**
 * One product's price entries, satisfying the invariant. The originals are not
 * mutated and an entry that already names an orderable SKU is returned exactly
 * as it arrived; `dropped` and `synthesised` carry the SKU codes so a caller
 * can report what it corrected.
 */
function coverPriceEntries(product, { tiers = true, variants = true } = {}) {
  const entries = Array.isArray(product?.priceEntries)
    ? product.priceEntries
    : [];

  const byCode = new Map();

  for (const entry of entries) {
    const code = entrySkuCodeOf(entry);

    if (code && !byCode.has(code)) {
      byCode.set(code, entry);
    }
  }

  const template = templateEntry(product, entries);
  const templateSku = template
    ? [...(product?.skus || []), ...(product?.skuVariants || [])].find((sku) =>
        skuCodesOf(sku).includes(entrySkuCodeOf(template))
      )
    : undefined;
  const templateModifier = modifierOf(templateSku);

  const priceEntries = [];
  const synthesised = [];
  const kept = new Set();

  for (const sku of priceableSkusFor(product, variants)) {
    const codes = skuCodesOf(sku);
    const existing = codes.map((code) => byCode.get(code)).find(Boolean);

    if (existing) {
      priceEntries.push(existing);
      kept.add(existing);
      continue;
    }

    // Nothing to derive from is not a failure: a run with no pricing option
    // ticked asks the model for no entries at all.
    if (!template) {
      continue;
    }

    priceEntries.push(derivedEntry(template, templateModifier, sku, codes[0]));
    synthesised.push(codes[0]);
  }

  return {
    dropped: entries
      .filter((entry) => !kept.has(entry))
      .map((entry) => entrySkuCodeOf(entry) || '(no SKU named)'),
    priceEntries: tiers
      ? priceEntries
      : priceEntries.map(stripUnaskedDecoration),
    synthesised,
  };
}

module.exports = {
  MINIMUM_PRICE,
  coverPriceEntries,
};
