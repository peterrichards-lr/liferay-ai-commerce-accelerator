const {
  createERC,
  normalizeSpecificationKey,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const { markBackorderShare } = require('../../utils/backorderShare.cjs');

const S = WORKFLOW_STEPS;

async function runProductDataGenerationStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, options, groundingMetadata, productDataList } =
    session.context;

  // IMPORT MODE: If data is already provided in the context, skip generation
  if (productDataList && productDataList.length > 0) {
    this.logger.info(
      `Skipping product data generation (Import Mode: ${productDataList.length} items)`,
      { sessionId }
    );

    // Normalize ERCs and specifications for imported data if they are missing
    const normalized = productDataList.map((p) => {
      const specs = p.productSpecifications || p.specifications || [];
      const normalizedSpecs = specs.map((spec) => {
        // Liferay looks specifications up by the normalized key but stores it
        // verbatim, so emit a key that is already normalized.
        const key = normalizeSpecificationKey(
          spec.specificationKey ||
            spec.key ||
            spec.label?.en_US ||
            spec.label?.[Object.keys(spec.label || {})[0]] ||
            spec.title ||
            spec.name
        );
        return {
          ...spec,
          specificationKey: key,
        };
      });
      return {
        ...p,
        externalReferenceCode:
          p.externalReferenceCode || createERC(ERC_PREFIX.PRODUCT),
        specifications: normalizedSpecs,
        productSpecifications: normalizedSpecs,
        skus: (p.skus || []).map((s) => ({
          ...s,
          externalReferenceCode: s.externalReferenceCode || s.sku,
        })),
        skuVariants: (p.skuVariants || []).map((v) => ({
          ...v,
          externalReferenceCode: v.externalReferenceCode || v.sku,
        })),
      };
    });

    await this.persistence.updateSessionContext(sessionId, {
      productDataList: normalized,
    });

    return await this.completeSyncStep(
      sessionId,
      S.GENERATE_PRODUCT_DATA,
      'SYNCHRONOUS',
      normalized.length,
      normalized.length
    );
  }

  try {
    const allData = await generateProductData.call(
      this,
      config,
      { ...options, groundingMetadata },
      sessionId,
      session.correlationId
    );
    if (options.productCount > 0 && (!allData || allData.length === 0)) {
      throw new Error(
        `Product generation returned 0 products for requested count of ${options.productCount}.`
      );
    }
    // Marked once, here, where the list is first assembled. The product step
    // sends the flag and the inventory step caps the stock of the products
    // carrying it; recomputing the share in either would agree only while the
    // rule, the list and the ratio stayed identical in both places (#695).
    await this.persistence.updateSessionContext(sessionId, {
      productDataList: markBackorderShare(allData, options, {
        logger: this.logger,
      }),
    });
    await this.completeSyncStep(
      sessionId,
      S.GENERATE_PRODUCT_DATA,
      'SYNCHRONOUS',
      allData.length,
      options.productCount
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed product data generation step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.GENERATE_PRODUCT_DATA,
      status: 'FAILED',
    });
    throw error;
  }
}

async function generateProductData(
  config,
  options,
  _sessionId,
  _correlationId
) {
  const data = await this.ctx.generation.generateData(
    'product',
    options.productCount,
    config,
    options
  );
  return data.map((p) => {
    // A run with specifications switched off skips ensure-specifications, so
    // nothing registers a definition for what the model returned here. Liferay
    // resolves a product's specifications by key at creation time and would
    // have nothing to resolve against, so they are dropped rather than sent
    // dangling. See #647.
    const specs = options.generateSpecifications
      ? p.productSpecifications || p.specifications || []
      : [];
    const normalizedSpecs = specs.map((spec) => {
      // Liferay looks specifications up by the normalized key but stores it
      // verbatim, so emit a key that is already normalized.
      const key = normalizeSpecificationKey(
        spec.specificationKey ||
          spec.key ||
          spec.label?.en_US ||
          spec.label?.[Object.keys(spec.label || {})[0]] ||
          spec.title ||
          spec.name
      );
      return {
        ...spec,
        specificationKey: key,
      };
    });
    return {
      ...p,
      externalReferenceCode: createERC(ERC_PREFIX.PRODUCT),
      specifications: normalizedSpecs,
      productSpecifications: normalizedSpecs,
      // Liferay Commerce ignores nested SKU ERCs during product creation and uses the SKU code.
      // We must use the SKU code as the ERC to ensure successful resolution later.
      skus: (p.skus || []).map((s) => ({
        ...s,
        externalReferenceCode: s.externalReferenceCode || s.sku,
      })),
      skuVariants: (p.skuVariants || []).map((v) => ({
        ...v,
        externalReferenceCode: v.externalReferenceCode || v.sku,
      })),
    };
  });
}

module.exports = {
  runProductDataGenerationStep,
};
