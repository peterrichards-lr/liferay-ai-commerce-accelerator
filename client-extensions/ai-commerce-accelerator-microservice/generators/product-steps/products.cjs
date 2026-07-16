const { deepCleanIds } = require('../../utils/payload-cleaner.cjs');
const {
  createERC,
  resolveErrorReference,
  toI18n,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');

const S = WORKFLOW_STEPS;

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
    const prepared = productDataList.map((pd) => {
      // Liferay Headless Commerce API (v1.0) requires all products to be 'simple' during initial creation.
      const productType = 'simple';

      const lp = {
        catalogId: parseInt(config.catalogId, 10),
        name: toI18n(pd.name),
        shortDescription: toI18n(pd.shortDescription || pd.description),
        description: toI18n(pd.description),
        productType,
        productStatus: 0, // Published
        active: true,
        productConfiguration: {
          productTaxConfiguration: {
            taxCategory: 'Standard',
            taxable: true,
          },
        },
        externalReferenceCode: pd.externalReferenceCode,
        categories: (pd.categories || []).map((catId) => ({ id: catId })),
        // HARDENING: Establishing indirect channel relationship at creation
        productChannels: [
          {
            channelId: parseInt(config.channelId, 10),
          },
        ],
        productSpecifications: (
          pd.productSpecifications ||
          pd.specifications ||
          []
        ).map((spec) => {
          const { externalReferenceCode: _erc, ...rest } = spec;
          return {
            ...rest,
            specificationKey: spec.specificationKey,
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
  runProductCreationStep,
  runResolveProductIdsStep,
  cleanProductForLiferay,
};
