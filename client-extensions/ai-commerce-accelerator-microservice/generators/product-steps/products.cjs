const { deepCleanIds } = require('../../utils/payload-cleaner.cjs');
const {
  createERC,
  normalizeSpecificationKey,
  resolveErrorReference,
  toI18n,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const { PATH, byERC } = require('../../utils/liferayPaths.cjs');
const { resolveRunChannelIds } = require('../../utils/runChannels.cjs');
const { readCatalogExpiryFields } = require('../../utils/catalogExpiry.cjs');

const S = WORKFLOW_STEPS;

const CHANNEL_PAGE_SIZE = 200;
const PRODUCT_PAGE_SIZE = 200;

async function runProductCreationStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList, options, defaultSpecificationCategoryId } =
    session.context;

  if (!productDataList || productDataList.length === 0) {
    return await this.completeSyncStep(
      sessionId,
      S.CREATE_PRODUCTS,
      'BYPASSED'
    );
  }

  try {
    const runChannelIds = resolveRunChannelIds(config);
    // Read once, so every product a run creates expires at the same moment
    // rather than drifting with however long the step takes.
    const expiryFields = await readCatalogExpiryFields(
      this.ctx?.config,
      config
    );

    const prepared = productDataList.map((pd, productIndex) => {
      // Liferay Headless Commerce API (v1.0) requires all products to be 'simple' during initial creation.
      const productType = 'simple';

      const lp = {
        catalogId: parseInt(config.catalogId, 10),
        name: toI18n(pd.name),
        shortDescription: toI18n(pd.shortDescription || pd.description),
        description: toI18n(pd.description),
        productType,
        productStatus: 0, // WorkflowConstants.STATUS_APPROVED
        active: true,
        // Liferay already defaults a product to never expiring, so this is only
        // load-bearing when expiry is configured. It is sent unconditionally
        // anyway: the SKU path defaults the same field the other way, and
        // leaving either side to a platform default is how #681 happened.
        ...expiryFields,
        // Sent on the first product only, and deliberately so.
        //
        // Liferay applies this to the definition's MASTER configuration entry
        // (ProductResourceImpl._updateNestedResources), and
        // CPConfigurationEntrySetting has no classNameId or classPK - it is
        // keyed by CPConfigurationEntryId, company and group. So this is one
        // shared row, not a per-product setting, and sending it with every
        // product updated the same row once per item.
        //
        // Liferay's batch engine runs import tasks concurrently, so those
        // updates raced: "Batch update returned unexpected row count from
        // update [1]; actual row count: 0; expected: 1" - an optimistic-lock
        // failure that discarded a whole batch and stopped the workflow. It
        // appeared only once runs grew past a single import task, and raising
        // the batch size so everything fitted in one task merely moved the
        // threshold rather than removing it.
        //
        // One write applies the same value with no second writer to race.
        ...(productIndex === 0
          ? {
              productConfiguration: {
                productTaxConfiguration: {
                  taxCategory: 'Standard',
                  taxable: true,
                },
              },
            }
          : {}),
        externalReferenceCode: pd.externalReferenceCode,
        // `{ id: undefined }` serialises to `{}`, which Liferay rejects for the
        // whole product - "/categories/0 must have required property 'id'" - so
        // one unresolved category loses the entire item. A product with no
        // category is worth more than no product. See #651.
        // Note the id must also survive deepCleanIds, which used to strip 'id'
        // from every nested object; ID_REQUIRED_NESTED_KEYS now exempts this one.
        categories: (pd.categories || [])
          .map((category) =>
            category && typeof category === 'object' ? category.id : category
          )
          .filter(
            (id) => id !== null && id !== undefined && id !== '' && id !== 0
          )
          .map((id) => ({ id })),
        // HARDENING: Establishing indirect channel relationship at creation.
        // Every channel the run names, not just the primary one, so a single
        // catalogue can back a B2B and a B2C storefront from the outset.
        // See #664.
        productChannels: runChannelIds.map((channelId) => ({ channelId })),
        productSpecifications: (
          pd.productSpecifications ||
          pd.specifications ||
          []
        ).map((spec) => {
          const { externalReferenceCode: _erc, ...rest } = spec;
          return {
            ...rest,
            // Must match the key ensure-specifications stored, and must already
            // be normalized - Liferay normalizes only on lookup, not on write.
            specificationKey: normalizeSpecificationKey(spec.specificationKey),
            // Liferay ignores specificationId here and resolves by key, then by
            // this ERC; the ERC is the reliable half.
            ...(spec.specificationExternalReferenceCode
              ? {
                  specificationExternalReferenceCode:
                    spec.specificationExternalReferenceCode,
                }
              : {}),
            label: spec.label || toI18n(spec.title || spec.value || spec.name),
            value: spec.value || spec.title || spec.name,
            optionCategoryId: defaultSpecificationCategoryId,
            specificationId: spec.specificationId,
          };
        }),
      };

      const hasSkuContributingOptions = (
        pd.productOptions ||
        pd.options ||
        []
      ).some((o) => o.skuContributor);

      if (pd.skus && pd.skus.length > 0) {
        // Rule: If product has SKU-contributing options, omit SKUs in initial payload
        // because they must be created AFTER options are linked to have correct skuOptions.
        if (options.generateSkuVariants && hasSkuContributingOptions) {
          this.logger.debug(
            `Omitting SKUs for ${pd.externalReferenceCode} due to SKU-contributing options`,
            { sessionId }
          );
        } else {
          lp.skus = pd.skus.slice(0, 1).map((s) => ({
            sku: s.sku,
            externalReferenceCode: s.externalReferenceCode || s.sku,
            published: true,
            purchasable: true,
            ...expiryFields,
          }));
        }
      }

      return deepCleanIds(lp);
    });

    if (prepared.length === 0) {
      throw new Error('No products prepared for creation');
    }

    const batchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      await this.submitBatch(
        sessionId,
        S.CREATE_PRODUCTS,
        'products',
        'generate',
        (erc) =>
          this.liferay.createProductsBatch(config, chunk, {
            externalReferenceCode: erc,
            sessionId,
            session,
          }),
        chunk.length
      );
    }
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed product creation step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.CREATE_PRODUCTS,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runResolveProductIdsStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList } = session.context;

  if (!productDataList || productDataList.length === 0) {
    return await this.completeSyncStep(
      sessionId,
      S.RESOLVE_PRODUCT_IDS,
      'BYPASSED'
    );
  }

  try {
    const ercs = productDataList
      .map((p) => p.externalReferenceCode)
      .filter(Boolean);
    const resolvedItems = await this.liferay.resolveByERCsWithRetry(
      config,
      ercs,
      (cfg, e) =>
        this.liferay.getProductsByERC(cfg, e, ['id', 'externalReferenceCode']),
      { label: 'products' }
    );

    const normalized = this._normalize(resolvedItems);
    const ercToIdMap = new Map(normalized.map((item) => [item.erc, item.id]));

    const updatedList = productDataList.map((p) => ({
      ...p,
      id: ercToIdMap.get(p.externalReferenceCode),
    }));

    await this.persistence.updateSessionContext(sessionId, {
      productDataList: updatedList,
    });
    await this.completeSyncStep(
      sessionId,
      S.RESOLVE_PRODUCT_IDS,
      'SYNCHRONOUS',
      normalized.length,
      ercs.length
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed to resolve product IDs', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.RESOLVE_PRODUCT_IDS,
      status: 'FAILED',
    });
    throw error;
  }
}

/**
 * The products the channel-linking step should cover.
 *
 * A run that generated products knows exactly which ones it made. A run that
 * generated none - the "accounts and orders only, against a second channel"
 * half of a two-run build - is reusing whatever the catalog already holds, so
 * that is what it has to reach for.
 */
async function resolveProductERCsToLink(config, productDataList) {
  const runERCs = (productDataList || [])
    .map((pd) => pd.externalReferenceCode)
    .filter(Boolean);

  if (runERCs.length > 0) {
    return [...new Set(runERCs)];
  }

  const existing = await this.liferay.getProducts(config, {
    catalogId: config.catalogId,
    pageSize: PRODUCT_PAGE_SIZE,
  });
  const items = existing?.items || (Array.isArray(existing) ? existing : []);

  return [
    ...new Set(items.map((p) => p.externalReferenceCode).filter(Boolean)),
  ];
}

/**
 * Returns true when the product gained a channel it did not have.
 *
 * The catalog API exposes product-channels as GET and DELETE only - there is
 * no POST - so the association can only be written through the product itself,
 * whose DTO carries productChannels as a nested collection.
 *
 * The PATCH sends the union of the existing channels and the new ones rather
 * than only the additions. ProductResourceImpl's update path calls
 * deleteCommerceChannelRels for the whole product before re-adding whatever
 * the payload names, so sending only the additions would silently drop the
 * channel an earlier run established - the exact thing this step exists to
 * preserve.
 *
 * productChannelFilter is deliberately left out: Liferay keeps the product's
 * existing flag when the field is absent, and turning channel filtering on for
 * a product that did not have it would restrict a product that was previously
 * visible everywhere.
 */
async function addProductChannels(config, productERC, channelIds) {
  const existing = await this.liferay.rest._get(
    config,
    PATH.PRODUCT_CHANNELS_BY_ERC(productERC),
    'get-product-channels',
    'Failed to read product channels',
    { params: { pageSize: CHANNEL_PAGE_SIZE } }
  );
  const linkedIds = new Set(
    (existing?.items || (Array.isArray(existing) ? existing : []))
      .map((productChannel) => parseInt(productChannel.channelId, 10))
      .filter(Number.isInteger)
  );

  const missing = channelIds.filter((channelId) => !linkedIds.has(channelId));

  if (missing.length === 0) {
    return false;
  }

  await this.liferay.rest._patch(
    config,
    byERC(PATH.BASE.PRODUCTS, productERC, PATH.VARIANT.products),
    {
      productChannels: [...linkedIds, ...missing].map((channelId) => ({
        channelId,
      })),
    },
    'patch-product-channels',
    'Failed to add product channels'
  );

  return true;
}

async function runLinkProductChannelsStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList } = session.context;
  const stepKey = S.LINK_PRODUCT_CHANNELS;

  try {
    const channelIds = resolveRunChannelIds(config);
    const productERCs = channelIds.length
      ? await resolveProductERCsToLink.call(this, config, productDataList)
      : [];

    if (channelIds.length === 0 || productERCs.length === 0) {
      return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
    }

    this.logger.info(
      `Linking ${productERCs.length} products to channels ${channelIds.join(', ')}`,
      { sessionId }
    );

    let updated = 0;
    for (const productERC of productERCs) {
      if (await addProductChannels.call(this, config, productERC, channelIds)) {
        updated++;
      }
    }

    this.logger.info(
      `Added channel associations to ${updated} of ${productERCs.length} products`,
      { sessionId }
    );

    return await this.completeSyncStep(
      sessionId,
      stepKey,
      'SYNCHRONOUS',
      productERCs.length,
      productERCs.length
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed to link products to channels', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey,
      status: 'FAILED',
    });
    throw error;
  }
}

function cleanProductForLiferay(product, options = {}) {
  let clean = this.deepClean(product);

  if (options.stripSkuOptions && clean.skus) {
    clean.skus = clean.skus.map((s) => {
      const { skuOptions: _skuOptions, ...rest } = s;
      return rest;
    });
  }

  return clean;
}

module.exports = {
  runLinkProductChannelsStep,
  runProductCreationStep,
  runResolveProductIdsStep,
  cleanProductForLiferay,
};
