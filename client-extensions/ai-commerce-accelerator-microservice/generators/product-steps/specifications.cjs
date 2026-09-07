const {
  createERC,
  buildKeyedERC,
  buildSpecificationERC,
  normalizeSpecificationKey,
  sanitizeForERC,
  toI18n,
  fromI18n,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const { COMMERCE_CONSTRAINTS } = require('../../utils/commerceConstants.cjs');
const { toOptionValues } = require('../../utils/optionValues.cjs');

const S = WORKFLOW_STEPS;

async function runEnsureSpecificationCategoriesStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config } = session.context;

  this.logger.info('Starting ensure specification categories step', {
    sessionId,
    correlationId: session.correlationId,
  });

  try {
    // For now, we ensure a default "General" specification category exists
    const defaultCategory = {
      // prefixIsCompound keeps the hyphen in 'AICA-OPT-CAT'. Without it
      // sanitizeForERC strips it to 'AICAOPTCAT', which no longer matches the
      // 'AICA-' prefix the deletion crawl looks for, so the record becomes
      // undeletable and accumulates on every run.
      externalReferenceCode: buildKeyedERC({
        prefix: ERC_PREFIX.OPTION_CATEGORY,
        category: 'SPC',
        key: 'general',
        prefixIsCompound: true,
      }),
      key: 'general',
      name: { en_US: 'General' },
      name_i18n: { en_US: 'General' },
      title: { en_US: 'General' },
      title_i18n: { en_US: 'General' },
      description: { en_US: 'Auto-generated general specification group' },
    };

    const liferayCategory =
      await this.liferay.createSpecificationCategoryWithReuse(
        config,
        defaultCategory
      );

    await this.persistence.updateSessionContext(sessionId, {
      // HARDENING: Store the full category metadata object
      defaultSpecificationCategory: {
        id: liferayCategory.id,
        key: liferayCategory.key || defaultCategory.key,
        title: liferayCategory.title || defaultCategory.title,
      },
      defaultSpecificationCategoryId: liferayCategory.id, // Keep legacy for safety
    });

    await this.completeSyncStep(
      sessionId,
      S.ENSURE_SPECIFICATION_CATEGORIES,
      'SYNCHRONOUS',
      1,
      1
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed ensure specification categories step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.ENSURE_SPECIFICATION_CATEGORIES,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runEnsureSpecificationsStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList, defaultSpecificationCategory } =
    session.context;

  if (!productDataList || productDataList.length === 0) {
    return await this.completeSyncStep(
      sessionId,
      S.ENSURE_SPECIFICATIONS,
      'BYPASSED'
    );
  }

  this.logger.info('Starting ensure specifications step', {
    sessionId,
    correlationId: session.correlationId,
  });

  try {
    // 1. Identify all unique specification keys used in the generated data
    const specMap = new Map();
    for (const product of productDataList) {
      const specs =
        product.productSpecifications || product.specifications || [];
      for (const spec of specs) {
        if (spec.specificationKey) {
          // Defensive: keys are normalized at generation time, but any other
          // route into this step must agree with what Liferay will look up.
          specMap.set(normalizeSpecificationKey(spec.specificationKey), spec);
        }
      }
    }

    const uniqueKeys = Array.from(specMap.keys());
    if (uniqueKeys.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.ENSURE_SPECIFICATIONS,
        'BYPASSED'
      );
    }

    this.logger.debug(
      `Synchronizing ${uniqueKeys.length} specification definitions...`,
      {
        sessionId,
        keys: uniqueKeys,
      }
    );

    // 2. Ensure each specification exists in Liferay
    let createdCount = 0;
    const updatedProductDataList = JSON.parse(JSON.stringify(productDataList));
    const specificationDefinitions = [];

    for (const key of uniqueKeys) {
      const spec = specMap.get(key);
      const title = spec.title || spec.name || { en_US: toI18n(key).en_US };

      const liferaySpec = await this.liferay.createSpecificationWithReuse(
        config,
        {
          externalReferenceCode: buildSpecificationERC(key),
          key: key,
          title: typeof title === 'string' ? { en_US: title } : title,
          description: { en_US: `Auto-generated specification for ${key}` },
          // HARDENING: Use full metadata object to satisfy Liferay's strict validation
          optionCategory: defaultSpecificationCategory,
        }
      );

      if (liferaySpec) {
        specificationDefinitions.push(liferaySpec);
      }

      // Update all products that use this specification with the real specificationId
      if (liferaySpec?.id) {
        for (const product of updatedProductDataList) {
          const productSpecs =
            product.productSpecifications || product.specifications || [];
          for (const pSpec of productSpecs) {
            const pKey = normalizeSpecificationKey(
              pSpec.specificationKey || pSpec.label?.en_US || pSpec.label
            );
            if (pKey === key) {
              pSpec.specificationKey = key;
              pSpec.specificationId = liferaySpec.id;
              // Liferay's key lookup is unreliable (it normalizes on read and
              // stores raw on write); the ERC lookup it falls back to is not.
              if (liferaySpec.externalReferenceCode) {
                pSpec.specificationExternalReferenceCode =
                  liferaySpec.externalReferenceCode;
              }
            }
          }
        }
      }
      createdCount++;
    }

    // Save the updated product data with specificationIds back to context
    await this.persistence.updateSessionContext(sessionId, {
      productDataList: updatedProductDataList,
      specificationDefinitions,
    });

    await this.completeSyncStep(
      sessionId,
      S.ENSURE_SPECIFICATIONS,
      'SYNCHRONOUS',
      createdCount,
      uniqueKeys.length
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed ensure specifications step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.ENSURE_SPECIFICATIONS,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runEnsureOptionsStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList } = session.context;

  if (!productDataList || productDataList.length === 0) {
    return await this.completeSyncStep(sessionId, S.ENSURE_OPTIONS, 'BYPASSED');
  }

  this.logger.info('Starting ensure options step', {
    sessionId,
    correlationId: session.correlationId,
  });

  try {
    // 1. Identify all unique options used in the generated data
    const optionMap = new Map();
    for (const product of productDataList) {
      const options = product.productOptions || product.options || [];
      for (const opt of options) {
        const key = opt.key || sanitizeForERC(opt.name?.en_US || opt.name);
        if (key) {
          optionMap.set(key, opt);
        }
      }
    }

    const uniqueKeys = Array.from(optionMap.keys());
    if (uniqueKeys.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.ENSURE_OPTIONS,
        'BYPASSED'
      );
    }

    this.logger.debug(
      `Synchronizing ${uniqueKeys.length} option definitions...`,
      {
        sessionId,
        keys: uniqueKeys,
      }
    );

    // 2. Ensure each option exists in Liferay
    let processedCount = 0;
    const updatedProductDataList = JSON.parse(JSON.stringify(productDataList));
    const optionDefinitions = [];

    for (const key of uniqueKeys) {
      const sourceOpt = optionMap.get(key);

      const optionData = {
        // See the note above: 'AICA-OPT' must survive as 'AICA-OPT', not
        // 'AICAOPT', or the option cannot be discovered for deletion.
        externalReferenceCode: buildKeyedERC({
          prefix: ERC_PREFIX.OPTION,
          category: 'OPT',
          key: key,
          prefixIsCompound: true,
        }),
        key: key,
        name:
          typeof sourceOpt.name === 'string'
            ? { en_US: sourceOpt.name }
            : sourceOpt.name,
        fieldType: sourceOpt.fieldType || 'select',
        skuContributor:
          sourceOpt.skuContributor !== undefined
            ? sourceOpt.skuContributor
            : true,
      };

      // Handle Option Values if applicable
      const sourceValues =
        sourceOpt.productOptionValues || sourceOpt.values || [];
      if (
        sourceValues.length > 0 &&
        COMMERCE_CONSTRAINTS.FIELD_TYPES_WITH_VALUES.includes(
          optionData.fieldType?.toLowerCase()
        )
      ) {
        // The prompt asks for `productOptionValues` as an array of plain
        // strings - `["Black", "Silver"]` - while this read `v.name`, which is
        // undefined for a string. Liferay then rejects the whole option with
        // 400 "optionValues[0].name must not be null", and the run dies at
        // ensure-options. Both shapes are accepted now, because the prompt is
        // editable and an operator may well supply objects. See #648.
        // Shared with link-product-options, so the two cannot drift.
        optionData.optionValues = toOptionValues(sourceValues, sanitizeForERC);
      }

      const liferayOption = await this.liferay.createOptionWithReuse(
        config,
        optionData
      );

      if (liferayOption) {
        optionDefinitions.push(liferayOption);
      }

      // Map IDs back to productDataList
      if (liferayOption?.id) {
        const valueNameToIdMap = new Map();
        if (Array.isArray(liferayOption.optionValues)) {
          liferayOption.optionValues.forEach((v) => {
            // Normalize name for matching
            const vName =
              typeof v.name === 'string'
                ? v.name
                : fromI18n(v.name_i18n || v.name);
            if (vName) valueNameToIdMap.set(vName.toLowerCase(), v.id);
          });
        }

        for (const product of updatedProductDataList) {
          const productOpts = product.productOptions || product.options || [];
          for (const pOpt of productOpts) {
            const pKey =
              pOpt.key || sanitizeForERC(pOpt.name?.en_US || pOpt.name);
            if (pKey === key) {
              pOpt.optionId = liferayOption.id;
              pOpt.key = key;

              // Also map value IDs if they exist
              const pValues = pOpt.productOptionValues || pOpt.values || [];
              pOpt.optionValuesWithIds = pValues.map((val) => {
                const valName =
                  typeof val === 'string'
                    ? val
                    : fromI18n(val.name_i18n || val.name || val);
                return {
                  name: valName,
                  optionValueId: valName
                    ? valueNameToIdMap.get(valName.toLowerCase())
                    : null,
                };
              });
            }
          }
        }
      }
      processedCount++;
    }

    // Save the updated product data with optionIds back to context
    await this.persistence.updateSessionContext(sessionId, {
      productDataList: updatedProductDataList,
      optionDefinitions,
    });

    await this.completeSyncStep(
      sessionId,
      S.ENSURE_OPTIONS,
      'SYNCHRONOUS',
      processedCount,
      uniqueKeys.length
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed ensure options step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.ENSURE_OPTIONS,
      status: 'FAILED',
    });
    throw error;
  }
}

module.exports = {
  runEnsureSpecificationCategoriesStep,
  runEnsureSpecificationsStep,
  runEnsureOptionsStep,
};
