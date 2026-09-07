const {
  delay,
  createERC,
  fromI18n,
  sanitizeForERC,
  toI18n,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const { toOptionValues } = require('../../utils/optionValues.cjs');

/**
 * Liferay's Sku.price / promoPrice / cost accept any number >= 0. The AI
 * generates skus[].price and skuVariants[].price, but the payload used to drop
 * them, so every SKU was created with no price at all. That left the catalog's
 * base price list showing 0.00 and, because order items resolve
 * `sku.price || ...`, every order total came out as zero.
 */
function priceFields(source = {}, fallback = {}) {
  const fields = {};

  for (const name of ['price', 'promoPrice', 'cost']) {
    const value = Number(
      source[name] !== undefined && source[name] !== null
        ? source[name]
        : fallback[name]
    );

    if (Number.isFinite(value) && value >= 0) {
      fields[name] = value;
    }
  }

  return fields;
}

const S = WORKFLOW_STEPS;

async function runResolveSkuIdsStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList, options } = session.context;

  if (!productDataList || productDataList.length === 0) {
    return await this.completeSyncStep(
      sessionId,
      S.RESOLVE_SKU_IDS,
      'BYPASSED'
    );
  }

  // HARDENING: Resolve ONLY the SKUs that were actually sent to Liferay
  const skuErcs = [];
  for (const p of productDataList) {
    const hasSkuContributingOptions = (
      p.productOptions ||
      p.options ||
      []
    ).some((o) => o.skuContributor);

    if (
      options.generateSkuVariants &&
      hasSkuContributingOptions &&
      Array.isArray(p.skuVariants)
    ) {
      // 1. Variant SKUs
      skuErcs.push(
        ...p.skuVariants.map((v) => v.externalReferenceCode).filter(Boolean)
      );
    } else if (Array.isArray(p.skus)) {
      // 2. Base SKUs (only if variants were not generated)
      skuErcs.push(
        ...p.skus.map((s) => s.externalReferenceCode).filter(Boolean)
      );
    }
  }

  const uniqueErcs = [...new Set(skuErcs)];

  try {
    this.logger.info(
      `Resolving physical database IDs for ${uniqueErcs.length} SKUs...`,
      { sessionId }
    );

    const resolvedItems = await this.liferay.resolveByERCsWithRetry(
      config,
      uniqueErcs,
      (cfg, e) =>
        this.liferay.getSkusByERC(cfg, e, ['id', 'externalReferenceCode']),
      { label: 'skus', tolerateMissing: true }
    );

    const normalized = this._normalize(resolvedItems);
    const ercToIdMap = new Map(normalized.map((item) => [item.erc, item.id]));

    const updatedList = productDataList.map((p) => ({
      ...p,
      // Update IDs on Base SKUs
      skus: (p.skus || []).map((sku) => ({
        ...sku,
        id: ercToIdMap.get(sku.externalReferenceCode) || sku.id,
      })),
      // Update IDs on Variant SKUs
      skuVariants: (p.skuVariants || []).map((variant) => ({
        ...variant,
        id: ercToIdMap.get(variant.externalReferenceCode) || variant.id,
      })),
    }));

    await this.persistence.updateSessionContext(sessionId, {
      productDataList: updatedList,
    });

    await this.completeSyncStep(
      sessionId,
      S.RESOLVE_SKU_IDS,
      'SYNCHRONOUS',
      normalized.length,
      uniqueErcs.length
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed to resolve SKU IDs', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.RESOLVE_SKU_IDS,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runLinkProductOptionsStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList } = session.context;

  try {
    const productsWithOpts = (productDataList || []).filter((p) => {
      const opts = p.productOptions || p.options;
      return p.id && Array.isArray(opts) && opts.length > 0;
    });

    for (const product of productsWithOpts) {
      this.logger.debug(
        `Linking options for product ${product.externalReferenceCode} (ID: ${product.id})`,
        { sessionId }
      );
      const sourceOptions = product.productOptions || product.options;
      const cleanedOptions = sourceOptions.map((opt) => {
        const name =
          typeof opt.name === 'string' ? { en_US: opt.name } : opt.name;
        const key = opt.key || sanitizeForERC(name?.en_US || name);

        const isGenerateVariants =
          session.context?.options?.generateSkuVariants;

        // HARDENING: Strict DTO Mapping (No Ghost Properties)
        const cleanOpt = {
          optionId: opt.optionId,
          key: key,
          name: name,
          fieldType: opt.fieldType,
          required: opt.required || false,
          skuContributor:
            isGenerateVariants === false ? false : opt.skuContributor || false,
        };

        // Liferay Headless Commerce API (v1.0) expects 'productOptionValues'
        const sourceValues = opt.productOptionValues || opt.values || [];

        if (sourceValues.length > 0) {
          // Shared with ensure-options: the AI sends plain strings, Liferay
          // requires { key, name }. Reading `val.name` gave undefined for a
          // string, so Liferay rejected the whole option with
          // "productOptionValues[0].name must not be null". See #653.
          cleanOpt.productOptionValues = toOptionValues(
            sourceValues,
            sanitizeForERC
          );
        }

        return cleanOpt;
      });

      const createdOptions = await this.liferay.addProductOptions(
        config,
        product.id,
        cleanedOptions,
        product.externalReferenceCode // HARDENING: Pass ERC to bypass indexing race condition
      );

      // Map the generated IDs back to the product context for SKU mapping
      const createdArray = Array.isArray(createdOptions)
        ? createdOptions
        : createdOptions?.items || [];

      const updatedOpts = sourceOptions.map((opt) => {
        const name =
          typeof opt.name === 'string' ? { en_US: opt.name } : opt.name;
        const key = opt.key || sanitizeForERC(name?.en_US || name);

        const createdOpt = createdArray.find((co) => co.key === key);
        if (createdOpt) {
          opt.optionId = createdOpt.id || createdOpt.productOptionId;
          opt.optionValuesWithIds = (createdOpt.productOptionValues || []).map(
            (cv) => ({
              optionValueId: cv.id || cv.productOptionValueId,
              name: cv.name,
              key: cv.key,
            })
          );
        }
        return opt;
      });

      product.options = updatedOpts;
      product.productOptions = updatedOpts;
    }

    // We must explicitly save the mutated context to the database
    await this.persistence.updateSessionContext(sessionId, {
      productDataList,
    });
    await this.completeSyncStep(
      sessionId,
      S.LINK_PRODUCT_OPTIONS,
      'SYNCHRONOUS',
      productsWithOpts.length,
      productsWithOpts.length
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed to link options', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.LINK_PRODUCT_OPTIONS,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runProductSkusStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList, options } = session.context;

  try {
    const preparedProducts = (productDataList || [])
      .map((pd) => {
        const lp = {
          catalogId: parseInt(config.catalogId, 10),
          name: toI18n(pd.name),
          productType: pd.productType || 'simple',
          externalReferenceCode: pd.externalReferenceCode,
        };

        const hasSkuContributingOptions = (
          pd.productOptions ||
          pd.options ||
          []
        ).some((o) => o.skuContributor);

        // If variants are enabled, generate all SKUs with option mappings
        if (
          options.generateSkuVariants &&
          hasSkuContributingOptions &&
          Array.isArray(pd.skuVariants)
        ) {
          lp.skus = pd.skuVariants.map((v) => {
            const sku = {
              sku: v.sku,
              externalReferenceCode: v.externalReferenceCode || v.sku,
              published: true,
              purchasable: true,
              skuOptions: [],
              ...priceFields(v, (pd.skus || [])[0] || {}),
            };

            if (v.options) {
              // A name may arrive as a plain string or as an i18n object, and
              // String({en_US: 'Black'}) sanitises to nothing useful, so both
              // sides go through fromI18n before they are compared.
              const label = (value) =>
                sanitizeForERC(
                  typeof value === 'string' ? value : fromI18n(value) || ''
                );

              const unresolved = [];

              sku.skuOptions = Object.entries(v.options)
                .map(([optName, valName]) => {
                  const optMeta = (pd.productOptions || pd.options || []).find(
                    (o) => label(o.name) === label(optName) || o.key === optName
                  );

                  const valMeta = (optMeta?.optionValuesWithIds || []).find(
                    (vMeta) => label(vMeta.name) === label(valName)
                  );

                  return {
                    optionId: optMeta?.optionId || 0,
                    optionValueId: valMeta?.optionValueId || 0,
                    _requested: `${optName}=${String(valName)}`,
                  };
                })
                .filter((o) => {
                  // The filter used to test optionId alone, so an entry whose
                  // value had not resolved went out as optionValueId 0. There
                  // is no option value 0: Liferay rejected the insert with
                  // ConstraintViolationException and lost the whole batch of
                  // SKUs. A SKU without one option link is worth more than no
                  // SKU at all.
                  const usable = o.optionId > 0 && o.optionValueId > 0;

                  if (!usable) {
                    unresolved.push(o._requested);
                  }

                  return usable;
                })
                .map(({ optionId, optionValueId }) => ({
                  optionId,
                  optionValueId,
                }));

              if (unresolved.length > 0) {
                this.logger.warn(
                  `SKU ${v.sku}: dropped ${unresolved.length} option link${unresolved.length === 1 ? '' : 's'} that did not resolve to a Liferay option value`,
                  { sessionId, sku: v.sku, unresolved }
                );
              }
            }
            return sku;
          });
        } else if (Array.isArray(pd.skus) && pd.skus.length > 0) {
          // Fallback for simple products or if variants disabled
          lp.skus = pd.skus.map((s) => ({
            sku: s.sku,
            externalReferenceCode: s.externalReferenceCode || s.sku,
            published: true,
            purchasable: true,
            ...priceFields(s),
          }));
        }

        return this._cleanProductForLiferay(lp);
      })
      .filter((p) => Array.isArray(p.skus) && p.skus.length > 0);

    if (preparedProducts.length > 0) {
      // HARDENING: Brief delay to allow Liferay's Option links to propagate
      // before we attempt to create SKUs that use those links.
      await delay(2000);

      const batchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
      for (let i = 0; i < preparedProducts.length; i += batchSize) {
        const batch = preparedProducts.slice(i, i + batchSize);
        await this.submitBatch(
          sessionId,
          S.CREATE_PRODUCT_SKUS,
          'skus',
          'generate',
          (erc) =>
            this.liferay.createProductsBatch(config, batch, {
              externalReferenceCode: erc,
              sessionId,
              session,
            }),
          batch.length
        );
      }
    } else {
      await this.completeSyncStep(
        sessionId,
        S.CREATE_PRODUCT_SKUS,
        'SYNCHRONOUS'
      );
    }
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed product SKUs creation step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.CREATE_PRODUCT_SKUS,
      status: 'FAILED',
    });
    throw error;
  }
}

module.exports = {
  runResolveSkuIdsStep,
  runLinkProductOptionsStep,
  runProductSkusStep,
};
