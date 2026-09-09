const { COMMERCE_CONSTRAINTS } = require('./commerceConstants.cjs');
const { label } = require('./productOptionLinks.cjs');
const { optionPairsToMap } = require('./schemaProjection.cjs');
const { fromI18n, sanitizeForERC } = require('./misc.cjs');

/**
 * Makes a product's declared option values and the values its SKU variants use
 * the same set, in both directions.
 *
 * Liferay activates a SKU only when it carries a value for every option the
 * product declares as a SKU contributor, and `resolveSkuOptionLink` can only
 * produce that value when the option declares it. So the two sets have to
 * agree, and generated data disagrees both ways:
 *
 *   a variant naming a value its option does not declare
 *     -> VALUE_NOT_MATCHED, the link is dropped, the SKU is inactive. The
 *        2026-09-08 run shipped 22 SKUs that could not be bought.
 *   a declared value no variant names
 *     -> a storefront picker entry with nothing behind it.
 *
 * Both are closed by covering, never by deleting. A declared value with no
 * variant is not a value that should not exist; it is a variant the model
 * failed to return. `prompts/product.md` allows 2-3 options (:23) and 8-12
 * variants (:28), so a two-option three-value product has nine combinations
 * available and needs only three variants to cover every value - the model is
 * under-delivering, not being squeezed. Pruning the value would make the
 * catalogue self-consistent by making it smaller and hide that. See #754.
 *
 * This has to run at generate-product-data rather than next to the linking it
 * protects: ensure-options registers the *global* CPOption values from the same
 * `productOptionValues` array, and it runs several steps before
 * link-product-options. A value added any later would reach linking with no
 * global option value behind it.
 *
 * Matching goes through `productOptionLinks.label`, the comparison
 * `resolveSkuOptionLink` itself uses. Anything else could declare a value that
 * still failed to match at link time, which is the defect rather than the fix.
 */

/**
 * `prompts/product.md:28` asks the model for 8-12 variants per product. It is a
 * budget for the model, not a Liferay constraint, so covering may exceed it -
 * but never quietly.
 */
const VARIANT_BUDGET = 12;

/**
 * Can this option hold declared values at all?
 *
 * `numeric` and `text` must keep an empty `productOptionValues`
 * (`prompts/product.md:59`), and `reconcileOptionFieldType` drops the
 * contributor flag from a valueless option, so they define no variant and are
 * excluded from both directions rather than corrected here.
 */
function carriesValues(option) {
  return COMMERCE_CONSTRAINTS.FIELD_TYPES_WITH_VALUES.includes(
    String(option?.fieldType || 'select').toLowerCase()
  );
}

function valuesKeyOf(option) {
  return Array.isArray(option?.productOptionValues) ||
    !Array.isArray(option?.values)
    ? 'productOptionValues'
    : 'values';
}

function valuesOf(option) {
  const values = option?.[valuesKeyOf(option)];
  return Array.isArray(values) ? values : [];
}

/**
 * The plain string a value carries, whichever shape it arrives in.
 *
 * The AI and the generation schema use plain strings; `toOptionValues` accepts
 * `{ key, name }` too because the prompt is an editable configuration item and
 * an operator may supply them.
 */
function plainValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  const named = value?.name ?? value?.key;

  return (named === undefined ? fromI18n(value) : fromI18n(named)) || '';
}

function nameOf(option) {
  return plainValue(option?.name) || plainValue(option?.key) || '';
}

function selectionOf(variant) {
  const selection = optionPairsToMap(variant?.options);

  return selection && !Array.isArray(selection) && typeof selection === 'object'
    ? selection
    : {};
}

/**
 * The value a variant selected for one option, or undefined when it selected
 * none. Undefined rather than an empty string: `label('')` is 'NA', which would
 * match a value genuinely named "N/A".
 */
function selectedValue(selection, optionName) {
  const wanted = label(optionName);

  for (const [name, value] of Object.entries(selection)) {
    if (label(name) === wanted) {
      return value;
    }
  }

  return undefined;
}

function baseSkuOf(product) {
  return (
    product?.baseSku ||
    product?.skus?.[0]?.sku ||
    product?.externalReferenceCode ||
    'SKU'
  );
}

/**
 * Liferay reads a SKU's price from the SKU itself and the pricing step derives
 * a missing price entry from `priceModifier`, so a synthesised variant inherits
 * both from the sibling it was derived from: same product, one option value
 * different, so the sibling's price is the closest honest estimate available.
 */
function inheritedFields(donor) {
  const fields = {
    inStock: donor?.inStock !== false,
    priceModifier:
      typeof donor?.priceModifier === 'number' ? donor.priceModifier : 0,
  };

  if (typeof donor?.price === 'number') {
    fields.price = donor.price;
  }

  if (typeof donor?.promoPrice === 'number') {
    fields.promoPrice = donor.promoPrice;
  }

  if (typeof donor?.cost === 'number') {
    fields.cost = donor.cost;
  }

  return fields;
}

/**
 * A SKU code that reads like the ones beside it and is not already taken.
 *
 * The generators compose a variant code as the base SKU plus one segment per
 * contributing option - "SOLARA-001-BLK-S". When the donor's code has that
 * shape the differing segment is substituted, so the new code stays in the
 * abbreviated house style the model chose; otherwise the code is composed from
 * the base SKU and the selected values, which is how mockDataGenerator builds
 * one.
 */
function composeSku(
  product,
  donor,
  selection,
  contributing,
  optionName,
  taken
) {
  const baseSku = baseSkuOf(product);
  const prefix = `${baseSku}-`;
  const index = contributing.findIndex(
    (entry) => label(nameOf(entry.option)) === label(optionName)
  );
  const donorSegments =
    typeof donor?.sku === 'string' && donor.sku.startsWith(prefix)
      ? donor.sku.slice(prefix.length).split('-')
      : null;

  let candidate;

  if (
    donorSegments &&
    index >= 0 &&
    donorSegments.length === contributing.length
  ) {
    const substitute = sanitizeForERC(
      plainValue(selectedValue(selection, optionName))
    );
    const segments = donorSegments.map((segment, position) =>
      position === index ? substitute : segment
    );
    candidate = [baseSku, ...segments].join('-');
  } else {
    const segments = contributing
      .map((entry) => selectedValue(selection, nameOf(entry.option)))
      .filter((value) => value !== undefined)
      .map((value) => sanitizeForERC(plainValue(value)));
    candidate = [baseSku, ...segments].join('-');
  }

  let sku = candidate;
  let attempt = 2;

  while (taken.has(sku)) {
    sku = `${candidate}-${attempt}`;
    attempt += 1;
  }

  taken.add(sku);

  return sku;
}

/**
 * Liferay Commerce ignores a nested SKU's ERC during product creation and
 * resolves by the SKU code, so the two are deliberately the same string - the
 * rule `prompts/product.md:18` states and `generation.cjs` enforces.
 */
function asVariant(sku, selection, donor) {
  return {
    sku,
    externalReferenceCode: sku,
    options: selection,
    ...inheritedFields(donor),
  };
}

function coveringVariant(product, donor, entry, value, contributing, taken) {
  const optionName = nameOf(entry.option);
  const donorSelection = selectionOf(donor);
  const selection = { ...donorSelection };
  const existingKey = Object.keys(selection).find(
    (name) => label(name) === label(optionName)
  );

  selection[existingKey || optionName] = plainValue(value);

  return asVariant(
    composeSku(product, donor, selection, contributing, optionName, taken),
    selection,
    donor
  );
}

/**
 * The first variant, for a product whose contributing options produced none.
 *
 * Without one there is nothing to derive from, and create-skus drops a product
 * whose variants are empty entirely - so this is the difference between a
 * product with no SKUs and a product with a covered set.
 */
function firstVariant(product, contributing, taken) {
  const selection = {};

  for (const entry of contributing) {
    selection[nameOf(entry.option)] = plainValue(entry.values[0]);
  }

  return asVariant(
    composeSku(product, null, selection, contributing, null, taken),
    selection,
    product?.skus?.[0]
  );
}

/**
 * One product's options and variants, satisfying the invariant in both
 * directions. The originals are not mutated; unchanged options are returned as
 * they arrived.
 */
function coverProductOptionValues(product, { logger, sessionId } = {}) {
  const declared = (product?.productOptions || product?.options || []).map(
    (option) => ({ option, values: [...valuesOf(option)] })
  );
  const variants = [...(product?.skuVariants || [])];

  const findDeclared = (optionName) => {
    const wanted = label(optionName);

    return declared.find(
      (entry) =>
        label(nameOf(entry.option)) === wanted ||
        label(entry.option?.key) === wanted
    );
  };

  const addedValues = [];

  for (const variant of variants) {
    for (const [optionName, value] of Object.entries(selectionOf(variant))) {
      const entry = findDeclared(optionName);
      const used = plainValue(value);
      const wanted = label(used);

      if (!entry || !used || !carriesValues(entry.option)) {
        continue;
      }

      if (
        entry.values.some(
          (declaredValue) => label(plainValue(declaredValue)) === wanted
        )
      ) {
        continue;
      }

      entry.values.push(used);
      addedValues.push(`${optionName}=${used}`);
    }
  }

  // Only contributing options partition the SKUs. A value on a non-contributing
  // option is offered on every SKU whether or not a variant names it, so it is
  // not a dead entry and needs no variant built for it - while a value on a
  // contributing option is a choice the storefront cannot fulfil.
  const contributing = declared.filter(
    (entry) =>
      entry.option?.skuContributor === true &&
      carriesValues(entry.option) &&
      entry.values.length > 0
  );

  const taken = new Set(
    variants.flatMap((variant) =>
      [variant?.sku, variant?.externalReferenceCode].filter(Boolean)
    )
  );

  const synthesised = [];

  if (contributing.length > 0 && variants.length === 0) {
    const seed = firstVariant(product, contributing, taken);
    variants.push(seed);
    synthesised.push(seed.sku);
  }

  for (const entry of contributing) {
    for (const value of entry.values) {
      const wanted = label(plainValue(value));
      const optionName = nameOf(entry.option);

      const covered = variants.some((variant) => {
        const selected = selectedValue(selectionOf(variant), optionName);
        return selected !== undefined && label(plainValue(selected)) === wanted;
      });

      if (covered) {
        continue;
      }

      const donor =
        variants.find(
          (variant) =>
            selectedValue(selectionOf(variant), optionName) !== undefined
        ) || variants[0];

      const variant = coveringVariant(
        product,
        donor,
        entry,
        value,
        contributing,
        taken
      );

      variants.push(variant);
      synthesised.push(variant.sku);
    }
  }

  // Reported rather than resolved. The alternative is to leave a value
  // uncovered, which is the defect, or to delete it, which the maintainer ruled
  // out; the fix belongs in the prompt, where the model can declare fewer
  // values in the first place.
  const overBudget = variants.length > VARIANT_BUDGET;

  if (overBudget && synthesised.length > 0) {
    logger?.warn?.(
      `Product ${product?.externalReferenceCode || baseSkuOf(product)}: covering every declared option value needs ${variants.length} variants, above the ${VARIANT_BUDGET} the prompt asks for; the values were covered rather than dropped`,
      { sessionId, variants: variants.length, budget: VARIANT_BUDGET }
    );
  }

  return {
    addedValues,
    options: declared.map((entry) =>
      entry.values.length === valuesOf(entry.option).length
        ? entry.option
        : { ...entry.option, [valuesKeyOf(entry.option)]: entry.values }
    ),
    overBudget,
    skuVariants: variants,
    synthesisedVariants: synthesised,
  };
}

module.exports = {
  VARIANT_BUDGET,
  coverProductOptionValues,
};
