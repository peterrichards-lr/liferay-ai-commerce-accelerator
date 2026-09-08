const {
  delay,
  createERC,
  sanitizeForERC,
  toI18n,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const { toOptionValues } = require('../../utils/optionValues.cjs');
const {
  reconcileOptionFieldType,
} = require('../../utils/optionFieldTypes.cjs');
const {
  LINKED_OPTION_ID,
  LINKED_OPTION_VALUES,
  findLinkedOption,
  readLinkedOption,
  resolveSkuOptionLink,
} = require('../../utils/productOptionLinks.cjs');

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

        // Liferay Headless Commerce API (v1.0) expects 'productOptionValues'
        const sourceValues = opt.productOptionValues || opt.values || [];

        // The same rule ensure-options satisfies applies again here, against
        // CPDefinitionOptionRel rather than CPOption, and is enforced by a
        // different exception: CPDefinitionOptionSKUContributorException. It
        // reaches us as a bare 500 - Liferay answers
        // {"status":"INTERNAL_SERVER_ERROR"} and keeps the reason in its own
        // log - so the pair has to be right before it is sent.
        const reconciled = reconcileOptionFieldType({
          fieldType: opt.fieldType,
          skuContributor: opt.skuContributor,
          valueCount: sourceValues.length,
          allowSkuContribution: isGenerateVariants !== false,
        });

        if (reconciled.adjusted) {
          this.logger.debug(
            `Adjusted option '${key}' to satisfy Liferay's SKU contributor rule`,
            {
              sessionId,
              requestedFieldType: opt.fieldType,
              fieldType: reconciled.fieldType,
              skuContributor: reconciled.skuContributor,
              valueCount: sourceValues.length,
            }
          );
        }

        // HARDENING: Strict DTO Mapping (No Ghost Properties)
        const cleanOpt = {
          optionId: opt.optionId,
          key: key,
          name: name,
          fieldType: reconciled.fieldType,
          required: opt.required || false,
          skuContributor: reconciled.skuContributor,
        };

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
      const asLinkedOptions = (response) =>
        Array.isArray(response) ? response : response?.items || [];

      let linkedOptions = asLinkedOptions(createdOptions);

      const optionKeys = sourceOptions.map(
        (opt) =>
          opt.key ||
          sanitizeForERC(
            (typeof opt.name === 'string' ? opt.name : opt.name?.en_US) ||
              opt.name
          )
      );

      const readLinkedIds = () =>
        optionKeys.map((key, index) =>
          readLinkedOption(
            findLinkedOption(linkedOptions, {
              key,
              optionId: sourceOptions[index].optionId,
            })
          )
        );

      let linkedIds = readLinkedIds();

      // Nothing obliges the POST response to expand productOptionValues, and
      // create-skus cannot resolve a variant without those ids. Rather than
      // rely on the write answering with them, read the definition back when
      // any option we sent values for came back without them. See #662.
      const needsReadBack = linkedIds.some(
        (linked, index) =>
          !linked ||
          (linked[LINKED_OPTION_VALUES].length === 0 &&
            (cleanedOptions[index].productOptionValues || []).length > 0)
      );

      if (
        needsReadBack &&
        typeof this.liferay.getProductOptions === 'function'
      ) {
        try {
          linkedOptions = asLinkedOptions(
            await this.liferay.getProductOptions(config, product.id)
          );
          linkedIds = readLinkedIds();
        } catch (readBackError) {
          this.logger.warn(
            `Could not read back the linked options for product ${product.externalReferenceCode}; SKU variants may lose their options`,
            { sessionId, error: readBackError.message }
          );
        }
      }

      const withoutOption = [];
      const withoutValues = [];

      const updatedOpts = sourceOptions.map((opt, index) => {
        const linked = linkedIds[index];

        if (!linked) {
          withoutOption.push(optionKeys[index]);
          return opt;
        }

        // opt.optionId stays the global option id ensure-options resolved: it
        // is what this step has to send as ProductOption.optionId, so a rerun
        // must not find a relationship id in its place.
        opt[LINKED_OPTION_ID] = linked[LINKED_OPTION_ID];
        opt[LINKED_OPTION_VALUES] = linked[LINKED_OPTION_VALUES];

        if (
          linked[LINKED_OPTION_VALUES].length === 0 &&
          (cleanedOptions[index].productOptionValues || []).length > 0
        ) {
          withoutValues.push(optionKeys[index]);
        }

        return opt;
      });

      // Distinct failures worth telling apart when a run is being read back:
      // the first says the option never reached the product definition, the
      // second that it did but its values did not come with it.
      if (withoutOption.length > 0) {
        this.logger.warn(
          `Product ${product.externalReferenceCode}: Liferay linked no product option for ${withoutOption.join(', ')}; SKU variants will lose those options`,
          { sessionId, options: withoutOption }
        );
      }

      if (withoutValues.length > 0) {
        this.logger.warn(
          `Product ${product.externalReferenceCode}: Liferay reported no option value relationships for ${withoutValues.join(', ')}; SKU variants will lose those options`,
          { sessionId, options: withoutValues }
        );
      }

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
              const productOptions = pd.productOptions || pd.options || [];
              const unresolved = [];

              // The ids come from the product definition's option and value
              // relationships, which only link-product-options can supply. A
              // pair is only ever sent complete: there is no option value 0,
              // and Liferay answers an insert carrying one with
              // ConstraintViolationException, discarding the whole batch of
              // SKUs. A SKU missing one option link is worth more than no SKU.
              for (const [optName, valName] of Object.entries(v.options)) {
                const { optionId, optionValueId, reason } =
                  resolveSkuOptionLink(productOptions, optName, valName);

                if (optionId && optionValueId) {
                  sku.skuOptions.push({ optionId, optionValueId });
                } else {
                  unresolved.push(`${optName}=${String(valName)} (${reason})`);
                }
              }

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
