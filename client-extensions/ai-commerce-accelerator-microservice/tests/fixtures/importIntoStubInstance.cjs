const {
  runProductCreationStep,
  cleanProductForLiferay,
} = require('../../generators/product-steps/products.cjs');
const {
  runProductSkusStep,
} = require('../../generators/product-steps/skus.cjs');
const {
  LINKED_OPTION_ID,
  LINKED_OPTION_VALUES,
} = require('../../utils/productOptionLinks.cjs');
const { fromI18n, sanitizeForERC } = require('../../utils/misc.cjs');
const { liferayInstanceStub } = require('./liferayInstanceStub.cjs');

/**
 * The target instance an import of `dataset` would leave behind.
 *
 * The point of the round trip is that the write side is the *real* write side.
 * `runProductCreationStep` and `runProductSkusStep` are the functions the
 * import schedules, called here with a harness rather than reimplemented, so a
 * field this fixture never mentions is a field the import genuinely drops -
 * which is exactly what the comparison is meant to find (#849).
 *
 * Three things are simulated rather than executed, and each is named because
 * an unexamined exclusion is how a fidelity test comes to prove nothing:
 *
 *   1. **ensure-categories.** It calls Liferay to create or find a taxonomy
 *      category and writes the resolved id onto `pd.categories`. Here the id
 *      is assigned locally and the category is stored under the name the
 *      dataset carried, which is what that step does.
 *   2. **ensure-options and link-product-options.** They register the global
 *      options and then read back the product definition's own option and
 *      value relationships. The ids are assigned locally, under the field
 *      names `productOptionLinks.cjs` exports, so the shape create-skus reads
 *      cannot drift from the shape this writes.
 *   3. **Liferay's own storage.** What is POSTed is what comes back, minus
 *      what Liferay does not persist from that payload.
 *
 * Everything else - which fields reach the payload at all, how SKUs are split
 * between the product create and the SKU create, how a variant's option
 * selection is resolved into link ids - is production code.
 */

const CATALOG_ID = 61432;

function harness({ config, productDataList, options, captured }) {
  const session = {
    context: {
      config,
      defaultSpecificationCategoryId: 70073,
      options,
      productDataList,
    },
  };

  const self = {
    completeSyncStep: async () => true,
    ctx: { config: undefined },
    deepClean: (value) => value,
    liferay: {
      createProductsBatch: async (_config, chunk) => {
        captured.push(...chunk);
        return { items: chunk };
      },
    },
    logger: {
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    },
    persistence: {
      createBatch: async () => true,
      getSession: async () => session,
      updateSessionContext: async () => true,
    },
    submitBatch: async (_sessionId, _stepKey, _entity, _mode, send) =>
      send('AICA-BATCH-TEST'),
  };

  self._cleanProductForLiferay = (product, opts) =>
    cleanProductForLiferay.call(self, product, opts);

  return self;
}

/** What ensure-categories leaves on each product, and in the target taxonomy. */
function resolveCategories(productDataList, locale) {
  const idsByName = new Map();
  let nextId = 80000;

  for (const product of productDataList) {
    const name = fromI18n(product.category, locale);

    if (!name) {
      product.categories = [];
      continue;
    }

    if (!idsByName.has(name)) {
      idsByName.set(name, { id: nextId++, name });
    }

    product.categories = [idsByName.get(name).id];
  }

  return new Map(
    [...idsByName.values()].map((category) => [category.id, category])
  );
}

/**
 * What ensure-options and link-product-options leave on each product's options.
 *
 * The global option id and the product definition's relationship id are
 * deliberately different numbers: they are different entities, and conflating
 * them is what let a global id reach a SKU while its value id stayed at zero
 * (#662). A fixture that used one number for both would let that class of bug
 * pass.
 */
function linkOptions(productDataList) {
  let nextGlobalId = 71500;
  let nextLinkId = 72500;

  for (const product of productDataList) {
    for (const option of product.options || []) {
      option.key = option.key || sanitizeForERC(fromI18n(option.name));
      option.optionId = nextGlobalId++;
      option[LINKED_OPTION_ID] = nextLinkId++;
      option[LINKED_OPTION_VALUES] = (option.productOptionValues || []).map(
        (value) => ({
          key: sanitizeForERC(value),
          name: { en_US: value },
          productOptionValueId: nextLinkId++,
        })
      );
    }
  }
}

/** The ProductOption DTOs a later read of the target would answer with. */
function productOptionDtos(product) {
  return (product.options || []).map((option, index) => ({
    fieldType: option.fieldType,
    id: option[LINKED_OPTION_ID],
    key: option.key,
    name: option.name,
    optionId: option.optionId,
    priority: index,
    productOptionValues: (option[LINKED_OPTION_VALUES] || []).map((value) => ({
      id: value.productOptionValueId,
      key: value.key,
      name: value.name,
    })),
    required: false,
    skuContributor: option.skuContributor === true,
  }));
}

/** Turn the link ids on a written SKU back into the key/value pair a read gives. */
function skuOptionDtos(skuOptions = [], product) {
  const options = product.options || [];

  return skuOptions.map((link) => {
    const option = options.find(
      (candidate) => candidate[LINKED_OPTION_ID] === link.optionId
    );
    const value = (option?.[LINKED_OPTION_VALUES] || []).find(
      (candidate) => candidate.productOptionValueId === link.optionValueId
    );

    return {
      key: option?.key,
      optionId: link.optionId,
      optionValueId: link.optionValueId,
      value: fromI18n(value?.name),
    };
  });
}

/**
 * @param {object} dataset A package's dataset half.
 * @param {object} [options] `locale`, and the run options the import sets.
 * @returns {{instance: object, payloads: {products: Array, skus: Array}}}
 */
async function importIntoStubInstance(dataset, { locale = 'en_US' } = {}) {
  // The options routes/import.cjs puts on the context, so the branch this
  // exercises is the branch a real import takes.
  const options = {
    generatePriceLists: true,
    generateSkuVariants: true,
    importMode: true,
  };
  const config = { batchSize: 50, catalogId: CATALOG_ID, channelId: 90001 };

  const productDataList = JSON.parse(JSON.stringify(dataset.products));

  const categories = resolveCategories(productDataList, locale);
  linkOptions(productDataList);

  const productPayloads = [];
  await runProductCreationStep.call(
    harness({
      captured: productPayloads,
      config,
      options,
      productDataList,
    }),
    'AICA-SESSION-TEST'
  );

  const skuPayloads = [];
  await runProductSkusStep.call(
    harness({
      captured: skuPayloads,
      config,
      options,
      productDataList,
    }),
    'AICA-SESSION-TEST'
  );

  const skusByProductERC = new Map(
    skuPayloads.map((payload) => [payload.externalReferenceCode, payload.skus])
  );
  const sourceByERC = new Map(
    productDataList.map((product) => [product.externalReferenceCode, product])
  );
  const mediaByProductERC = new Map();

  for (const record of [...(dataset.images || []), ...(dataset.pdfs || [])]) {
    const bucket = mediaByProductERC.get(record.productERC) || {
      attachments: [],
      images: [],
    };

    (record.contentType === 'application/pdf'
      ? bucket.attachments
      : bucket.images
    ).push({
      contentType: record.contentType,
      priority: record.priority,
      src: `/o/commerce-media/${record.productERC}`,
      title: record.title,
    });

    mediaByProductERC.set(record.productERC, bucket);
  }

  let nextProductId = 81000;
  let nextSkuId = 82000;

  const products = productPayloads.map((payload) => {
    const source = sourceByERC.get(payload.externalReferenceCode);
    const media = mediaByProductERC.get(payload.externalReferenceCode) || {
      attachments: [],
      images: [],
    };
    const productId = nextProductId++;
    const written = skusByProductERC.get(payload.externalReferenceCode) || [];

    return {
      attachments: media.attachments,
      images: media.images,
      options: productOptionDtos(source),
      product: {
        active: payload.active,
        catalogId: payload.catalogId,
        categories: (payload.categories || [])
          .map(({ id }) => categories.get(id))
          .filter(Boolean)
          .map((category) => ({
            externalReferenceCode: `CAT-${category.id}`,
            id: category.id,
            name: category.name,
            title: { [locale]: category.name },
            vocabulary: 'Category',
          })),
        description: payload.description,
        externalReferenceCode: payload.externalReferenceCode,
        id: productId - 1,
        name: payload.name,
        productConfiguration: {
          allowBackOrder: payload.productConfiguration?.allowBackOrder === true,
        },
        productId,
        productType: payload.productType,
        shortDescription: payload.shortDescription,
      },
      skus: written.map((sku) => ({
        cost: sku.cost,
        externalReferenceCode: sku.externalReferenceCode,
        id: nextSkuId++,
        price: sku.price,
        productId,
        promoPrice: sku.promoPrice,
        published: sku.published,
        purchasable: sku.purchasable,
        sku: sku.sku,
        skuOptions: skuOptionDtos(sku.skuOptions, source),
      })),
      specifications: (payload.productSpecifications || []).map(
        (specification, index) => ({
          externalReferenceCode: `PS-${productId}-${index}`,
          id: productId * 10 + index,
          label: specification.label,
          productId,
          specificationKey: specification.specificationKey,
          value: specification.value,
        })
      ),
    };
  });

  return {
    instance: liferayInstanceStub({
      priceLists: priceListsFrom(dataset, products),
      products,
    }),
    payloads: { products: productPayloads, skus: skuPayloads },
  };
}

/**
 * The price lists generate-price-lists would leave in the target.
 *
 * `pricing.cjs` needs resolved SKU ids and a live catalogue to write against,
 * so it is not run here; what it produces is not in doubt - one base entry per
 * priced SKU and one promotion entry per SKU with a promotional price - and
 * the codes it writes are rebuilt from scratch with buildStableERC either way,
 * so the source's codes could not survive and are not expected to.
 */
function priceListsFrom(dataset, products) {
  const written = new Map(
    products.flatMap((entry) =>
      entry.skus.map((sku) => [sku.externalReferenceCode, sku])
    )
  );

  const base = [];
  const promotion = [];

  for (const product of dataset.products) {
    for (const entry of product.priceEntries || []) {
      if (!written.has(entry.skuExternalReferenceCode)) continue;

      base.push({
        externalReferenceCode: `PE-${entry.skuExternalReferenceCode}-GENERAL`,
        price: entry.price,
        skuExternalReferenceCode: entry.skuExternalReferenceCode,
        tierPrices: (entry.tierPrices || []).map((tier) => ({
          externalReferenceCode: `TP-${entry.skuExternalReferenceCode}-${tier.minimumQuantity}`,
          minimumQuantity: tier.minimumQuantity,
          price: tier.price,
        })),
      });

      if (entry.promoPrice) {
        promotion.push({
          externalReferenceCode: `PE-${entry.skuExternalReferenceCode}-PROMO`,
          price: entry.promoPrice,
          skuExternalReferenceCode: entry.skuExternalReferenceCode,
        });
      }
    }
  }

  return [
    {
      catalogId: CATALOG_ID,
      entries: base,
      externalReferenceCode: 'PL-GENERAL',
      id: 30001,
      type: 'price-list',
    },
    {
      catalogId: CATALOG_ID,
      entries: promotion,
      externalReferenceCode: 'PL-PROMO',
      id: 30002,
      type: 'promotion',
    },
  ];
}

module.exports = { CATALOG_ID, importIntoStubInstance };
