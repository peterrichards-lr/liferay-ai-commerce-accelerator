const {
  createERC,
  sanitizeForERC,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');

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
        const key =
          spec.specificationKey ||
          spec.key ||
          sanitizeForERC(
            spec.label?.en_US ||
              spec.label?.[Object.keys(spec.label)[0]] ||
              spec.title ||
              spec.name ||
              'SPEC'
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
    await this.persistence.updateSessionContext(sessionId, {
      productDataList: allData,
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
    const specs = p.productSpecifications || p.specifications || [];
    const normalizedSpecs = specs.map((spec) => {
      const key =
        spec.specificationKey ||
        spec.key ||
        sanitizeForERC(
          spec.label?.en_US ||
            spec.label?.[Object.keys(spec.label)[0]] ||
            spec.title ||
            spec.name ||
            'SPEC'
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
