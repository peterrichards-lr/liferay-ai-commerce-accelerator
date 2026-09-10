const { fromI18n } = require('./misc.cjs');

/**
 * Liferay's DTO shape translated into the generation shape a package carries.
 *
 * A package holds `productDataList` - what the model produced - and not what
 * Liferay stores. An export from a session never has to think about that,
 * because the session already holds the generation shape. An extract does, and
 * #849 names the risk exactly: this is where a field gets silently dropped and
 * nobody notices until a promoted catalogue is missing something.
 *
 * So the translation is declared rather than written. `PRODUCT_FIELDS` names
 * every key of the generation shape, says where it comes from, and - for the
 * ones an instance cannot answer - says why it is absent. Two things follow
 * that hand-written object literals would not give:
 *
 *   - `tests/datasetTranslation.test.cjs` checks the declaration against
 *     `generation-schemas/product.json`, so a key added to the schema and not
 *     to this map fails a test instead of vanishing from every future extract.
 *   - `translateProduct` reports the declared keys it could not fill, per
 *     product, and the extract puts that report in the package. A short
 *     catalogue announces itself in the artefact rather than in a log the
 *     importer never sees - the same rule `mediaBundle` already applies to
 *     media it could not resolve (#814).
 *
 * The consumer is `routes/import.cjs` and the steps it schedules, not the
 * schema on its own; where the two differ the import wins, and the difference
 * is recorded here.
 */

/** Where a key of the generation shape comes from. */
const FROM = Object.freeze({
  /** Copied from a Liferay DTO field of the same meaning. */
  DTO: 'dto',
  /** Computed from other DTO data; the note says how. */
  DERIVED: 'derived',
  /** Deliberately not extracted; the note says why. */
  ABSENT: 'absent',
});

/**
 * Every property `generation-schemas/product.json` declares, and nothing else.
 *
 * `required` mirrors the schema's own required list. It is not enforced by
 * throwing - a product that reaches here has already been read from Liferay,
 * and refusing it would lose the other twenty-one - but an unfilled required
 * key is reported at a level the operator sees.
 */
const PRODUCT_FIELDS = Object.freeze({
  active: {
    from: FROM.DTO,
    note: 'Product.active. Carried for the round trip rather than for the import, which hard-codes active: true and never reads it (products.cjs:52).',
  },
  attachments: {
    from: FROM.DERIVED,
    note: 'The titles of the product attachments, per the schema, which types this as an array of names rather than of objects. Nothing on the import path reads it - the binaries travel in the bundle and are matched on the product ERC - so this is a record of the source.',
  },
  baseSku: {
    from: FROM.DERIVED,
    required: true,
    note: 'Liferay stores no base SKU for a product with SKU-contributing options - products.cjs never creates one - so it is the longest shared prefix of the variant codes, or the single base SKU when there is one.',
  },
  catalogId: {
    from: FROM.ABSENT,
    note: "A numeric id of the source instance, and meaningless in the target. products.cjs reads config.catalogId, which the import resolves through resolveRunCommerceSelection, and ignores the product's own. Carrying it would look like fidelity and change nothing.",
  },
  category: {
    from: FROM.DTO,
    note: 'Product.categories[0], by name. ensure-categories consumes `category` - the multilingual name - and resolves or creates the taxonomy category in the target itself; `categories` (the resolved id list) is its output, not its input, so extracting ids would be extracting the wrong thing.',
  },
  description: {
    from: FROM.DTO,
    required: true,
    note: 'Product.description. Hard-required for the same reason as name, and it doubles as the fallback for an absent shortDescription.',
  },
  externalReferenceCode: {
    from: FROM.DTO,
    required: true,
    note: "Product.externalReferenceCode. The dataset's identity, and what the round-trip comparison is keyed on.",
  },
  images: {
    from: FROM.DERIVED,
    note: "The image attachments' metadata. `src` names the source instance and is kept only because the schema requires it; nothing on the import path reads this key, and the target attaches the binaries the bundle carries, matched on the product ERC.",
  },
  metaDescription: {
    from: FROM.DTO,
    note: 'Product.metaDescription. Read by nothing on the import path; carried so the round trip can compare it.',
  },
  metaKeyword: {
    from: FROM.DTO,
    note: 'Product.metaKeyword. See metaDescription.',
  },
  metaTitle: {
    from: FROM.DTO,
    note: 'Product.metaTitle. See metaDescription.',
  },
  name: {
    from: FROM.DTO,
    required: true,
    note: 'Product.name. Hard-required: create-products calls toI18n on it, which throws when it is absent, and the step failing fails the session.',
  },
  options: {
    from: FROM.DTO,
    note: 'ProductOption[], with `productOptionValues` flattened to the value names ensure-options and link-product-options match on. `key` is kept alongside the name because findProductOption matches on either and the key is the stabler half.',
  },
  priceEntries: {
    from: FROM.DERIVED,
    note: "The catalogue's price lists, indexed by SKU. The import rebuilds every price-entry code with buildStableERC, so the codes here are informational; the prices, the promotional prices and the tiers are not.",
  },
  productType: {
    from: FROM.DTO,
    required: true,
    note: "Product.productType. Liferay's v1.0 API requires 'simple' at creation, so anything else will not survive an import.",
  },
  shortDescription: {
    from: FROM.DTO,
    required: true,
    note: 'Product.shortDescription.',
  },
  skuVariants: {
    from: FROM.DERIVED,
    note: 'The SKUs that carry skuOptions. `options` is rebuilt as a name-to-name map by resolving each skuOption against the product options, because that is what create-product-skus resolves back into link ids.',
  },
  skus: {
    from: FROM.DERIVED,
    required: true,
    note: 'The SKUs that carry no skuOptions. When there are none - the variant case - one entry is synthesised from the derived baseSku, because the schema requires a non-empty list and coverPriceEntries uses the base entry as the price template. products.cjs omits it from the payload in exactly that case, so nothing is created from it.',
  },
  specifications: {
    from: FROM.DTO,
    note: "ProductSpecification[]. The specification definition's own reference code is dropped: it names a row in the source instance, and ensure-specifications creates and re-attaches the target's own. `label` is the one field that must survive - create-products calls toI18n on `label || title || value || name` and throws when all four are absent.",
  },
  urls: {
    from: FROM.DTO,
    required: true,
    note: "Product.urls. Required by the schema and read by nothing on the import path - create-products does not send it - so a promoted product takes the target's own generated slug.",
  },
});

/**
 * The dataset-level keys `datasetFromSession` emits, and whether an instance
 * can answer them. Read by the extract to build its coverage report, so the
 * package says what it does not contain rather than leaving a caller to infer
 * it from an empty array (#849).
 */
const DATASET_COVERAGE = Object.freeze({
  accounts: {
    extracted: false,
    note: 'Not extracted. Accounts, their addresses and their orders are the second half of #849; nothing here reads them, and an empty list means "not attempted", not "none found".',
  },
  addresses: {
    extracted: false,
    note: 'Not extracted; see accounts.',
  },
  defaultSpecificationCategory: {
    extracted: false,
    note: "Not extracted. ensure-specification-categories creates the target's own 'General' category and writes it back to the context, so a source instance's copy would be overwritten before anything read it.",
  },
  groundingMetadata: {
    extracted: false,
    note: 'Not extractable. It records what the model was grounded on during a run and has no representation in Liferay.',
  },
  images: { extracted: true, note: 'Image attachment metadata, per product.' },
  optionDefinitions: {
    extracted: false,
    note: "Not extracted, and nothing is lost by it. ensure-options builds the definitions from the products' own `options` arrays and overwrites this key before anything reads it, so the value a package carries is read by no step on the import path.",
  },
  orders: {
    extracted: false,
    note: 'Not extracted; see accounts.',
  },
  pdfs: {
    extracted: true,
    note: 'Attachment metadata, per product.',
  },
  products: { extracted: true, note: 'See PRODUCT_FIELDS.' },
  specificationDefinitions: {
    extracted: false,
    note: 'Not extracted; see optionDefinitions. ensure-specifications does the same to this key.',
  },
  warehouses: {
    extracted: true,
    note: "Warehouse[], with the source instance's numeric id removed - create-warehouses treats a warehouse carrying an id as one it should adopt rather than create, so keeping it would leave the target with no warehouses at all. Note that assignWarehouseERCs replaces any code not beginning 'AICA-WH-', so a warehouse extracted from a catalogue AICA did not build lands in the target under a new code (#730).",
  },
});

const PRODUCT_SHAPE_KEYS = Object.freeze(Object.keys(PRODUCT_FIELDS));

/** Keys this module promises to fill when the instance has the data. */
const FILLED_PRODUCT_KEYS = Object.freeze(
  PRODUCT_SHAPE_KEYS.filter((key) => PRODUCT_FIELDS[key].from !== FROM.ABSENT)
);

const REQUIRED_PRODUCT_KEYS = Object.freeze(
  PRODUCT_SHAPE_KEYS.filter((key) => PRODUCT_FIELDS[key].required === true)
);

/**
 * Liferay answers with a localised map for most text and a bare string for
 * some of it - Category.name is a string while Category.title is a map - so
 * both are accepted and a map is what comes back. `undefined` rather than an
 * empty object, so an absent value is reported as absent.
 */
function localised(value, locale = 'en_US') {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'string') {
    return value === '' ? undefined : { [locale]: value };
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(
      ([, text]) => typeof text === 'string' && text !== ''
    );

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  return undefined;
}

/**
 * Did the instance answer this key, as distinct from answering "none"?
 *
 * An empty collection is an answer: a simple product genuinely has no
 * variants, and reporting that as a translation loss would bury the real
 * losses under one line per product. An absent text is not an answer, and the
 * difference is the whole value of the report.
 *
 * The exception is a key the schema requires. An empty `skus` is a product
 * that cannot be sold, whatever Liferay meant by it.
 */
function unanswered(value, { required = false } = {}) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return required && value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return value === '';
}

function positiveNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * The longest code every variant starts with, trimmed back to a separator.
 *
 * `MIN93016-BLK-L` and `MIN93016-RED-S` share `MIN93016-`, and the trailing
 * separator is dropped so the result is the code a run would have generated.
 * A single SKU is its own base.
 */
function commonPrefix(codes) {
  const usable = codes.filter(
    (code) => typeof code === 'string' && code.length > 0
  );

  if (usable.length === 0) return undefined;
  if (usable.length === 1) return usable[0];

  let prefix = usable[0];

  for (const code of usable.slice(1)) {
    let index = 0;
    while (index < prefix.length && prefix[index] === code[index]) index++;
    prefix = prefix.slice(0, index);
  }

  const trimmed = prefix.replace(/[-_\s]+$/, '');

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A product's options in the shape ensure-options reads.
 *
 * `fieldType` is lower-cased because the REST DTO answers 'select' and GraphQL
 * answers 'SELECT', while COMMERCE_CONSTRAINTS.FIELD_TYPES_WITH_VALUES - and
 * the generation schema's enum - are lower case throughout.
 */
function translateOptions(productOptions = [], locale) {
  return productOptions.map((option) => {
    const values = (option.productOptionValues || [])
      .map((value) => fromI18n(value?.name, locale) || value?.key)
      .filter(Boolean);

    return {
      fieldType: String(option.fieldType || '').toLowerCase() || undefined,
      key: option.key || undefined,
      name: localised(option.name, locale),
      productOptionValues: values,
      skuContributor: option.skuContributor === true,
    };
  });
}

function translateSpecifications(productSpecifications = [], locale) {
  return productSpecifications.map((specification) => ({
    label: localised(specification.label, locale),
    specificationKey:
      specification.specificationKey || specification.key || undefined,
    value: localised(specification.value, locale),
  }));
}

/**
 * One SKU's option selections as the name-to-name map create-product-skus
 * resolves back into link ids.
 *
 * `Sku.skuOptions` carries `{ key, optionId, optionValueId, value }` - read off
 * a live instance, recorded in the SDK's api-schemas/examples/reference-sku.json
 * - where the ids are the *product definition's* relationships, not the global
 * definitions, and so cannot travel. The names can, and resolveSkuOptionLink
 * rebuilds the ids in the target. The value is resolved through the product's
 * options by id first because that is the only unambiguous route; `value` is
 * the fallback for an instance that does not expand the relationship.
 */
function translateSkuOptions(skuOptions = [], productOptions = [], locale) {
  const optionsByKey = new Map(
    productOptions
      .filter((option) => option?.key)
      .map((option) => [String(option.key).toLowerCase(), option])
  );

  const selections = {};

  for (const skuOption of skuOptions) {
    const option = optionsByKey.get(String(skuOption?.key || '').toLowerCase());
    const optionName =
      fromI18n(option?.name, locale) || skuOption?.key || undefined;

    if (!optionName) continue;

    const matchedValue = (option?.productOptionValues || []).find(
      (value) => Number(value?.id) === Number(skuOption?.optionValueId)
    );

    const valueName =
      fromI18n(matchedValue?.name, locale) ||
      matchedValue?.key ||
      (skuOption?.value === undefined || skuOption?.value === null
        ? undefined
        : String(skuOption.value));

    if (valueName === undefined) continue;

    selections[optionName] = valueName;
  }

  return selections;
}

/**
 * Whether a SKU can be sold, as `skuVariants[].inStock` means it.
 *
 * Stock lives on warehouse items rather than on the SKU, so `inventoryLevel` is
 * consulted only when Liferay answered with one. Absent that, `purchasable` is
 * the closest thing the SKU itself says, and a SKU Liferay marks unpurchasable
 * is not in stock by any reading.
 */
function inStockOf(sku) {
  if (typeof sku?.inventoryLevel === 'number') {
    return sku.inventoryLevel > 0;
  }

  return sku?.purchasable !== false;
}

function translateBaseSku(sku) {
  return {
    cost: Number(sku.cost ?? 0),
    externalReferenceCode: sku.externalReferenceCode || sku.sku,
    inventoryLevel:
      typeof sku.inventoryLevel === 'number' ? sku.inventoryLevel : 0,
    price: Number(sku.price ?? 0),
    ...(sku.promoPrice === undefined || sku.promoPrice === null
      ? {}
      : { promoPrice: Number(sku.promoPrice) }),
    sku: sku.sku,
  };
}

/**
 * A variant's price expressed against the base, which is what the generation
 * shape records and what skus.cjs falls back to when a variant states no price.
 * Zero when there is no base to compare against, rather than a guess.
 */
function priceModifierOf(price, basePrice) {
  const variant = positiveNumber(price);
  const base = positiveNumber(basePrice);

  if (variant === undefined || base === undefined) return 0;

  return Number((variant / base - 1).toFixed(4));
}

function translateImages(images = [], locale) {
  return images
    .filter((image) => image?.src)
    .map((image) => ({
      priority: Number(image.priority ?? 1),
      src: image.src,
      title: localised(image.title, locale),
    }));
}

/**
 * Turn one Liferay product and everything read alongside it into the shape the
 * import consumes, and say which declared keys it could not fill.
 */
function translateProduct(
  {
    attachments = [],
    images = [],
    options = [],
    priceEntries = [],
    product,
    skus = [],
    specifications = [],
  },
  { locale = 'en_US' } = {}
) {
  const variantSkus = skus.filter(
    (sku) => Array.isArray(sku?.skuOptions) && sku.skuOptions.length > 0
  );
  const plainSkus = skus.filter(
    (sku) => !Array.isArray(sku?.skuOptions) || sku.skuOptions.length === 0
  );

  const baseSku =
    commonPrefix(
      (plainSkus.length > 0 ? plainSkus : variantSkus).map((sku) => sku.sku)
    ) || product.externalReferenceCode;

  const basePrice =
    positiveNumber(plainSkus[0]?.price) ??
    positiveNumber(
      Math.min(
        ...variantSkus.map((sku) => Number(sku.price)).filter(Number.isFinite)
      )
    );

  // The variant case leaves Liferay with no base SKU at all, and the schema
  // requires a non-empty `skus`. coverPriceEntries reads the base entry as the
  // price template, so a synthesised one is useful as well as required -
  // and products.cjs omits SKUs from the payload whenever the product has
  // SKU-contributing options, so nothing is created from it.
  const translatedBaseSkus =
    plainSkus.length > 0
      ? plainSkus.map(translateBaseSku)
      : variantSkus.length > 0
        ? [
            {
              cost: Number(variantSkus[0].cost ?? 0),
              externalReferenceCode: baseSku,
              inventoryLevel: 0,
              price: basePrice ?? 0,
              sku: baseSku,
            },
          ]
        : [];

  const translated = {
    active: product.active,
    attachments: attachments
      .map((attachment) => fromI18n(attachment?.title, locale))
      .filter(Boolean),
    baseSku,
    category: localised(
      product.categories?.[0]?.title ?? product.categories?.[0]?.name,
      locale
    ),
    description: localised(product.description, locale),
    externalReferenceCode: product.externalReferenceCode,
    images: translateImages(images, locale),
    metaDescription: localised(product.metaDescription, locale),
    metaKeyword: localised(product.metaKeyword, locale),
    metaTitle: localised(product.metaTitle, locale),
    name: localised(product.name, locale),
    options: translateOptions(options, locale),
    priceEntries,
    productType: product.productType,
    shortDescription: localised(product.shortDescription, locale),
    skuVariants: variantSkus.map((sku) => ({
      externalReferenceCode: sku.externalReferenceCode || sku.sku,
      inStock: inStockOf(sku),
      options: translateSkuOptions(sku.skuOptions, options, locale),
      price: Number(sku.price ?? 0),
      priceModifier: priceModifierOf(sku.price, basePrice),
      sku: sku.sku,
    })),
    skus: translatedBaseSkus,
    specifications: translateSpecifications(specifications, locale),
    urls: localised(product.urls, locale),
  };

  // allowBackOrder is not part of the generation schema - the model never
  // returns it - but products.cjs and the inventory step both read it off the
  // product, so an extract that dropped it would quietly turn backorders off
  // across a promoted catalogue. Set outside the declared map because the map
  // is checked against the schema and this key is deliberately not in it.
  if (typeof product.productConfiguration?.allowBackOrder === 'boolean') {
    translated.allowBackOrder = product.productConfiguration.allowBackOrder;
  }

  const missing = FILLED_PRODUCT_KEYS.filter((key) =>
    unanswered(translated[key], { required: PRODUCT_FIELDS[key].required })
  ).map((key) => ({
    key,
    required: PRODUCT_FIELDS[key].required === true,
  }));

  // An unanswered key is dropped from the object rather than emitted as null:
  // the import reads `pd.category`, `pd.options` and the rest with `||`
  // fallbacks, and a null there behaves as absence anyway, while a null in the
  // package reads as "Liferay said null" rather than "nothing was read". An
  // empty collection stays, because it is an answer.
  for (const key of FILLED_PRODUCT_KEYS) {
    if (unanswered(translated[key])) {
      delete translated[key];
    }
  }

  return { missing, product: translated };
}

/**
 * A Liferay warehouse in the shape create-warehouses reads.
 *
 * The field names already agree, so this is mostly about what to leave out.
 * `id` is the dangerous one: create-warehouses filters to `!warehouse.id` on
 * the rule that a warehouse carrying an id was adopted from the target and must
 * not be re-submitted (#730). A source instance's id passed straight through
 * would satisfy that filter for every warehouse in the dataset, and the import
 * would create none of them while reporting success.
 */
function translateWarehouse(warehouse, { locale = 'en_US' } = {}) {
  return {
    active: warehouse.active !== false,
    city: warehouse.city || undefined,
    countryISOCode: warehouse.countryISOCode || undefined,
    description: localised(warehouse.description, locale),
    externalReferenceCode: warehouse.externalReferenceCode,
    latitude:
      typeof warehouse.latitude === 'number' ? warehouse.latitude : undefined,
    longitude:
      typeof warehouse.longitude === 'number' ? warehouse.longitude : undefined,
    name: localised(warehouse.name, locale),
    regionISOCode: warehouse.regionISOCode || undefined,
    street1: warehouse.street1 || undefined,
    street2: warehouse.street2 || undefined,
    zip: warehouse.zip || undefined,
  };
}

module.exports = {
  DATASET_COVERAGE,
  FILLED_PRODUCT_KEYS,
  FROM,
  PRODUCT_FIELDS,
  PRODUCT_SHAPE_KEYS,
  REQUIRED_PRODUCT_KEYS,
  commonPrefix,
  localised,
  translateProduct,
  translateSkuOptions,
  translateWarehouse,
};
