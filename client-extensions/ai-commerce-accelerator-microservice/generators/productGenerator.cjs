const { ASSET_TYPE, VIEWABLE_BY } = require('../utils/liferayPermissions.cjs');
const specificationCatalog = require('../data/specifications.json');
const {
  delay,
  resolvePhaseAndMode,
  createERC,
  toI18n,
  buildOptionCategoryERC,
  buildSpecificationERC,
  now,
  isoNow,
  sanitizeForERC,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { COMMERCE_CONSTRAINTS } = require('../utils/commerceConstants.cjs');
const { sanitizedObject } = require('../utils/normalize.cjs');
const { v4: uuidv4 } = require('uuid');
const {
  getBatchCacheTTLms,
  getEphemeralTTLms,
  getSessionTTLms,
  getLongLivedTTLms,
} = require('../utils/ttl.cjs');

const RETRY = { maxAttempts: 3, baseMs: 500, factor: 2 };

class ProductGenerator {
  constructor(ctx) {
    this.ctx = ctx;

    this.steps = {
      'generate-warehouses': this._runWarehouseGenerationStep.bind(this),
      'resolve-warehouse-ids': this._runResolveWarehouseIdsStep.bind(this),
      'product-data-generation': this._runProductDataGenerationStep.bind(this),
      products: this._runProductCreationStep.bind(this),
      'resolve-product-ids': this._runResolveProductIdsStep.bind(this),
      'link-product-options': this._runLinkProductOptionsStep.bind(this),
      'product-skus': this._runProductSkusStep.bind(this),
      'attach-images': this._runAttachImagesStep.bind(this),
      'attach-pdfs': this._runAttachPdfsStep.bind(this),
      'update-inventory': this._runUpdateInventoryStep.bind(this),
    };
  }

  async generate(config, options) {
    const { logger, persistence, batchCallback } = this.ctx;
    const sessionId = options.sessionId || createERC(ERC_PREFIX.BATCH_SESSION);
    options.sessionId = sessionId;

    const steps = [
      { name: 'generate-warehouses', type: 'sync' },
      { name: 'resolve-warehouse-ids', type: 'sync' },
      { name: 'product-data-generation', type: 'sync' },
      { name: 'products', type: 'sync' },
      { name: 'resolve-product-ids', type: 'sync' },
      { name: 'link-product-options', type: 'sync' },
      { name: 'product-skus', type: 'sync' },
      {
        type: 'parallel',
        steps: [
          { name: 'attach-images', type: 'sync' },
          { name: 'attach-pdfs', type: 'sync' },
          { name: 'update-inventory', type: 'sync' },
        ],
      },
    ];

    await persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      currentSteps: [],
      context: {
        config,
        options,
        steps,
      },
    });

    batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    logger.info('Product generation workflow started', {
      sessionId,
      steps: steps.map((s) => s.name),
    });

    return {
      sessionId,
      message: 'Product generation workflow started.',
    };
  }

  async _runResolveProductIdsStep(sessionId) {
    const { logger, liferay, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, productDataList } = session.context;

    if (!productDataList || productDataList.length === 0) {
      logger.info('No products to resolve IDs for.', { sessionId });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-product-ids',
        status: 'BYPASSED',
      });
      return;
    }

    logger.info(`Resolving real numeric IDs for ${productDataList.length} products via GraphQL/ERC...`, { sessionId });

    const ercs = productDataList.map(p => p.externalReferenceCode).filter(Boolean);
    
    try {
      const maxRetries = parseInt(config.pollingRetries, 10) || 10;
      const delayMs = parseInt(config.pollingDelay, 10) || 5000;
      
      let resolvedItems = [];
      let success = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // getProductsByERC uses _fetchByERCs middle-layer which has built-in exponential backoff/retries for STALE_INDEX
          resolvedItems = await liferay.getProductsByERC(config, ercs, ['id', 'externalReferenceCode', 'productId']);
          success = true;
          break;
        } catch (error) {
          if (attempt === maxRetries) throw error;
          logger.warn(`Retrying product ID resolution (attempt ${attempt}/${maxRetries}) as search index may be stale...`, { sessionId });
          await delay(delayMs);
        }
      }
      
      const ercToIdMap = new Map();
      resolvedItems.forEach(item => {
        if (item) {
          ercToIdMap.set(item.externalReferenceCode, item.productId || item.id);
        }
      });

      const updatedProductDataList = productDataList.map(p => ({
        ...p,
        id: ercToIdMap.get(p.externalReferenceCode)
      }));

      await persistence.updateSessionContext(sessionId, {
        ...session.context,
        productDataList: updatedProductDataList,
      });

      logger.info('Successfully resolved product IDs.', { sessionId, resolvedCount: ercToIdMap.size });

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-product-ids',
        status: 'SYNCHRONOUS',
      });

    } catch (error) {
      logger.error('Failed to resolve product IDs', { sessionId, error: error.message });
      // If we can't resolve IDs, subsequent steps will fail anyway, so we fail the step.
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-product-ids',
        status: 'FAILED',
      });
    }
  }

  async _runResolveWarehouseIdsStep(sessionId) {
    const { logger, liferay, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options } = session.context;
    const warehouses = options?.warehouses || [];

    if (!warehouses || warehouses.length === 0) {
      logger.info('No warehouses to resolve IDs for.', { sessionId });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-warehouse-ids',
        status: 'BYPASSED',
      });
      return;
    }

    logger.info(`Resolving real numeric IDs for ${warehouses.length} warehouses via GraphQL/ERC...`, { sessionId });

    // Ensure we are using individual warehouse ERCs, not batch ERCs
    const ercs = warehouses
      .map(w => w.externalReferenceCode || w.erc)
      .filter(erc => erc && !erc.includes('-BATCH-'));
    
    if (ercs.length === 0) {
      logger.warn('No individual warehouse ERCs found for resolution. All warehouses may already have IDs or ERCs are missing.', { sessionId });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-warehouse-ids',
        status: 'SYNCHRONOUS',
      });
      return;
    }

    try {
      const maxRetries = parseInt(config.pollingRetries, 10) || 10;
      const delayMs = parseInt(config.pollingDelay, 10) || 5000;
      
      let resolvedItems = [];
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          resolvedItems = await liferay.getWarehousesByERC(config, ercs, ['id', 'externalReferenceCode', 'name']);
          
          // Verify we have all requested IDs
          const resolvedErcs = new Set(resolvedItems.filter(Boolean).map(it => it.externalReferenceCode));
          const missingCount = ercs.filter(erc => !resolvedErcs.has(erc)).length;

          if (missingCount === 0) {
            break;
          }

          if (attempt === maxRetries) {
            throw new Error(`Failed to resolve all warehouse IDs after ${maxRetries} attempts. Missing ${missingCount} IDs.`);
          }

          logger.warn(`Retrying warehouse ID resolution (attempt ${attempt}/${maxRetries}). Missing ${missingCount} of ${ercs.length} IDs.`, { sessionId });
          await delay(delayMs);
        } catch (error) {
          if (attempt === maxRetries) throw error;
          logger.warn(`Retrying warehouse ID resolution (attempt ${attempt}/${maxRetries}) due to error: ${error.message}`, { sessionId });
          await delay(delayMs);
        }
      }
      
      const ercToIdMap = new Map();
      resolvedItems.forEach(item => {
        if (item) {
          ercToIdMap.set(item.externalReferenceCode, item.id);
        }
      });

      const updatedWarehouses = warehouses.map(w => ({
        ...w,
        id: ercToIdMap.get(w.externalReferenceCode || w.erc) || w.id
      }));

      await persistence.updateSessionContext(sessionId, {
        ...session.context,
        options: {
          ...options,
          warehouses: updatedWarehouses
        }
      });

      logger.info('Successfully resolved warehouse IDs.', { sessionId, resolvedCount: ercToIdMap.size });

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-warehouse-ids',
        status: 'SYNCHRONOUS',
      });

    } catch (error) {
      logger.error('Failed to resolve warehouse IDs', { sessionId, error: error.message });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-warehouse-ids',
        status: 'FAILED',
      });
    }
  }

  async _runLinkProductOptionsStep(sessionId) {
    const { logger, liferay, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, productDataList, options } = session.context;

    logger.info('Starting product options linking step', { sessionId });

    const productsWithMissingOptions = (productDataList || []).filter(
      (p) => p.id && p.productOptions?.length > 0
    );

    if (productsWithMissingOptions.length > 0) {
      logger.info(
        `Linking options for ${productsWithMissingOptions.length} products`,
        { sessionId }
      );
      
      for (const product of productsWithMissingOptions) {
        try {
          // Link all options for this product
          // The productOptions were already built in _generateProductData
          await liferay.addProductOptions(config, product.id, product.productOptions);
          logger.trace(`Linked ${product.productOptions.length} options to product ${product.id}`, { sessionId });
        } catch (error) {
          logger.error(`Failed to link options for product ${product.id}`, {
            sessionId,
            error: error.message,
          });
        }
      }
    } else {
      logger.info('No products require option linking.', { sessionId });
    }

    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'link-product-options',
      status: 'SYNCHRONOUS',
    });
  }

  async _runProductSkusStep(sessionId) {
    const { logger, liferay, persistence, progress } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, productDataList, options } = session.context;

    logger.info('Starting product SKUs creation step (via product update batch)', { sessionId });

    const productsWithVariants = (productDataList || []).filter(
      (p) => p.skus?.length > 1
    );

    if (productsWithVariants.length > 0) {
      logger.info(
        `Submitting update batch for ${productsWithVariants.length} products to create variant SKUs`,
        { sessionId }
      );

      const preparedProducts = productsWithVariants.map((productData) => {
        const liferayProduct = {
          active: productData.active !== undefined ? productData.active : true,
          catalogId: parseInt(config.catalogId, 10),
          name: toI18n(productData.name),
          description: toI18n(productData.description),
          productType: productData.productType || 'simple',
          externalReferenceCode: productData.externalReferenceCode,
          productOptions: productData.productOptions,
          skus: productData.skus, // Include ALL SKUs this time
        };

        if (productData.productSpecifications) {
          liferayProduct.productSpecifications = productData.productSpecifications;
        }

        return liferayProduct;
      });

      const batchERC = createERC(ERC_PREFIX.PRODUCT_BATCH);
      
      await persistence.createBatch({
        erc: batchERC,
        sessionId,
        stepKey: 'product-skus',
        status: 'prepared',
      });

      const result = await liferay.createProductsBatch(config, preparedProducts, {
        externalReferenceCode: batchERC,
        sessionId,
      });

      if (result?.batchId) {
        await persistence.updateBatch(batchERC, {
          status: 'SUBMITTED',
          downstreamBatchId: result.batchId,
        });

        progress.batchStarted({
          sessionId,
          batchERC,
          batchId: result.batchId,
          totalItems: preparedProducts.length,
          entityType: 'products',
          operation: 'generate',
        });
      } else {
        await persistence.updateBatch(batchERC, { status: 'FAILED' });
      }
    } else {
      logger.info('No products require variant SKU creation.', { sessionId });
    }

    // Only create a synchronous batch marker if NO other batches were created for this step.
    const stepBatches = await persistence.getBatchesForSession(sessionId);
    const hasRealBatches = stepBatches.some(b => b.step_key === 'product-skus');

    if (!hasRealBatches) {
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'product-skus',
        status: 'SYNCHRONOUS',
      });
    }
  }

  async _runWarehouseGenerationStep(sessionId) {
    const { logger, liferay, warehouseGenerator, cache, persistence, batchCallback } =
      this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options } = session.context;

    if (!options.createWarehouses) {
      logger.info('Skipping warehouse generation step.', { sessionId });
      
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'generate-warehouses',
        status: 'BYPASSED',
      });
      
      return;
    }

    logger.info('Creating warehouses...', { sessionId });
    let warehouses = [];
    if (options.reuseExistingWarehouses) {
      logger.info('Checking for existing warehouses...', { sessionId });
      const existingWarehouses = await liferay.getWarehouses(config);
      warehouses = existingWarehouses?.items || [];
      logger.info('Found warehouses:', { warehouses, sessionId });
    }

    const warehouseCount = options.warehouseCount || 1;
    if (warehouses.length < warehouseCount) {
      const newWarehouseCount = warehouseCount - warehouses.length;
      logger.info('Calling createWarehouses', {
        warehouseCount: newWarehouseCount,
        sessionId,
      });
      const newWarehouses = await warehouseGenerator.createWarehouses(config, {
        ...options,
        warehouseCount: newWarehouseCount,
        sessionId,
        stepKey: 'generate-warehouses',
      });
      logger.info('Created new warehouses:', { count: newWarehouses.length, sessionId });
      warehouses.push(...newWarehouses);
    }

    const updatedOptions = { ...options, warehouses };
    await persistence.updateSessionContext(sessionId, {
      ...session.context,
      options: updatedOptions,
    });

    cache.set('generated-warehouses', warehouses);
    logger.info('Warehouses set in options and cache.', { sessionId });

    // Only create a synchronous batch marker if NO other batches were created for this step.
    // This allows the callback service to correctly track real asynchronous batches.
    const stepBatches = await persistence.getBatchesForSession(sessionId);
    const hasRealBatches = stepBatches.some(b => b.step_key === 'generate-warehouses');

    if (!hasRealBatches) {
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'generate-warehouses',
        status: 'SYNCHRONOUS',
      });
    }
  }

  async _runProductDataGenerationStep(sessionId) {
    const { logger, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options } = session.context;

    logger.info('Starting product data generation step', { sessionId });

    const allProductData = await this._generateProductData(
      config,
      options,
      sessionId
    );

    if (!allProductData || allProductData.length === 0) {
      logger.info('No product data generated. Skipping product creation.', {
        sessionId,
      });
      // Potentially end the workflow here if no data is generated
      return;
    }

    await persistence.updateSessionContext(sessionId, {
      ...session.context,
      productDataList: allProductData,
      options,
    });

    logger.info('Product data generation step complete', {
      sessionId,
      productCount: allProductData.length,
    });

    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'product-data-generation',
      status: 'SYNCHRONOUS',
    });
  }

  async _runProductCreationStep(sessionId) {
    const { logger, persistence } = this.ctx;
    const session = await persistence.getSession(sessionId);
    logger.info('Starting product creation step', { sessionId });
    await this.startProductsBatch({ sessionId, session });
  }


  async _generateProductData(config, options, sessionId) {
    const { logger, ai, mockData } = this.ctx;

    this.validateConfig(config);
    config.catalogId = parseInt(config.catalogId, 10);
    await this.validateOptions(config, options);

    if (options.imageRatio != null) {
      options.imageRatio = Math.max(
        0,
        Math.min(100, Number(options.imageRatio))
      );
    }
    if (options.pdfRatio != null) {
      options.pdfRatio = Math.max(0, Math.min(100, Number(options.pdfRatio)));
    }

    const selectedCategories =
      Array.isArray(options.categories) &&
      options.categories.length
        ? options.categories
        : [];
    if (selectedCategories.length === 0)
      throw new Error('At least one category must be selected.');

    const distributionMode = options.distributionMode || 'random';
    const categoryCounts = this.buildCategoryCounts(
      options.productCount,
      selectedCategories,
      distributionMode,
      logger
    );
    logger.info('Computed category distribution for this run', {
      entityType: 'products',
      operation: 'generate',
      ...resolvePhaseAndMode({ useBatch: true, phase: 'prepare' }),
      categoryCounts,
      total: options.productCount,
      distributionMode,
    });

    const allProductData = [];
    let catalogOptionsByCategory = {};
    let catalogSpecificationsByCategory = {};

    if (options.generateSkuVariants) {
      catalogOptionsByCategory = await this.createCatalogOptions(config, {
        ...options,
        sessionId,
      });
    }
    if (options.generateSpecifications) {
      catalogSpecificationsByCategory = await this.createCatalogSpecifications(
        config,
        {
          ...options,
          sessionId,
        }
      );
    }

    for (const category of selectedCategories) {
      const countForCategory = categoryCounts[category] || 0;
      if (countForCategory <= 0) {
        logger.trace(`Skipping category ${category} (assigned 0)`);
        continue;
      }
      logger.trace(
        `Generating ${countForCategory} products for category: ${category}`
      );
      try {
        let productDataList;
        if (options.demoMode) {
          productDataList = mockData.generateProductData(
            category,
            countForCategory,
            config.selectedLanguages || ['en-US'],
            {
              catalogId: config.catalogId,
              generateSpecifications: options.generateSpecifications,
              generateAttachments: options.generateAttachments,
              generateSkuVariants: options.generateSkuVariants,
              generatePriceLists: options.generatePriceLists,
              generateBulkPricing: options.generateBulkPricing,
              generateTierPricing: options.generateTierPricing,
              imageMode: options.imageMode,
              imageRatio: options.imageRatio || 0,
              pdfMode: options.pdfMode,
              pdfRatio: options.pdfRatio || 0,
            }
          );
        } else {
          productDataList = await ai.generateProductData(
            category,
            countForCategory,
            config,
            config.aiModel,
            config.selectedLanguages || ['en-US']
          );
        }
        if (options.generateSkuVariants || options.generateSpecifications) {
          const catOpts = catalogOptionsByCategory[category] || [];
          const catSpecs = catalogSpecificationsByCategory[category] || [];
          for (const pd of productDataList) {
            pd.__catalogOptions = catOpts;
            pd.__catalogSpecifications = catSpecs;
            pd.category = category;
            // Add productOptions and productSpecifications to productData
            if (
              options.generateSkuVariants &&
              pd.options &&
              Array.isArray(pd.options)
            ) {
              const catalogOptions = catOpts;
              const catalogOptionsMap = new Map();
              const catalogOptionsByKey = new Map();
              for (const co of catalogOptions) {
                catalogOptionsMap.set(co.name.en_US, co);
                catalogOptionsMap.set(co.name.en_US.toLowerCase(), co);
                catalogOptionsByKey.set(co.key, co);
              }
              pd.productOptions = pd.options
                .map((option) => {
                  const catalogOption = catalogOptionsMap.get(option.name) || catalogOptionsMap.get(option.name.toLowerCase());
                  if (catalogOption) {
                    return {
                      optionId: catalogOption.id,
                      optionExternalReferenceCode:
                        catalogOption.externalReferenceCode,
                      key: catalogOption.key,
                      name: catalogOption.name,
                      fieldType: catalogOption.fieldType,
                      facetable: catalogOption.facetable,
                      required: catalogOption.required,
                      skuContributor: catalogOption.skuContributor,
                    };
                  }
                  return null;
                })
                .filter(Boolean);

              // Infer product type: Liferay Commerce Headless API usually expects 'simple' even for products with variants.
              // We ensure it defaults to 'simple' to avoid CPDefinitionProductTypeNameException.
              const hasSkuContributor = pd.productOptions.some(opt => opt.skuContributor);
              if (hasSkuContributor) {
                pd.productType = 'simple';
              }

              if (pd.skuVariants && Array.isArray(pd.skuVariants)) {
                const variantSkus = pd.skuVariants
                  .map((variant) => {
                    const skuOptions = [];
                    for (const [optRef, valName] of Object.entries(
                      variant.options || {}
                    )) {
                      const catalogOption = 
                        catalogOptionsByKey.get(optRef) || 
                        catalogOptionsMap.get(optRef) || 
                        catalogOptionsMap.get(optRef.toLowerCase());

                      if (catalogOption) {
                        const catalogValue = (catalogOption.values || []).find(
                          (v) => v.name.en_US === valName || v.name === valName || v.name.en_US.toLowerCase() === valName.toLowerCase()
                        );
                        if (catalogValue) {
                          skuOptions.push({
                            optionId: catalogOption.id,
                            optionValueId: catalogValue.id,
                          });
                        }
                      }
                    }

                    return {
                      sku: variant.sku,
                      externalReferenceCode: createERC(ERC_PREFIX.SKU),
                      price: variant.price,
                      published:
                        variant.published !== undefined
                          ? variant.published
                          : true,
                      purchasable:
                        variant.purchasable !== undefined
                          ? variant.purchasable
                          : true,
                      neverExpire:
                        variant.neverExpire !== undefined
                          ? variant.neverExpire
                          : true,
                      inventoryLevel: variant.inStock ? 50 : 0,
                      skuOptions,
                    };
                  })
                  .filter((v) => v.skuOptions.length > 0);

                if (variantSkus.length > 0) {
                  pd.skus = variantSkus;
                  logger.trace(
                    `Replaced base SKU with ${variantSkus.length} variant SKUs for product ${pd.externalReferenceCode}`,
                    { sessionId }
                  );
                }
              }
            }
            if (options.generateSpecifications) {
              const provided = Array.isArray(pd.specifications)
                ? pd.specifications
                : [];
              const providedMap = new Map();
              for (const p of provided) {
                const k = (p.key || p.name || '').toString();
                if (!k) continue;
                providedMap.set(k, p);
              }
              const productSpecifications = [];
              for (const cs of catSpecs) {
                const p =
                  providedMap.get(cs.key) || providedMap.get(cs.title?.en_US);
                const valueObj = p?.value
                  ? typeof p.value === 'string'
                    ? { en_US: p.value }
                    : p.value
                  : { en_US: `Mock ${cs.title?.en_US || cs.key} Value` };
                const specPayload = {
                  specificationExternalReferenceCode: cs.externalReferenceCode,
                  specificationKey: cs.key,
                  specificationPriority: cs.priority || 0,
                  label: cs.title,
                  value: valueObj,
                };
                if (cs.optionCategoryId)
                  specPayload.optionCategoryId = cs.optionCategoryId;
                if (cs.optionCategoryExternalReferenceCode)
                  specPayload.optionCategoryExternalReferenceCode =
                    cs.optionCategoryExternalReferenceCode;
                productSpecifications.push(specPayload);
              }
              if (productSpecifications.length > 0) {
                pd.productSpecifications = productSpecifications;
              }
            }
          }
        }
        allProductData.push(...productDataList);
      } catch (error) {
        logger.error(
          `Failed to generate products for category ${category}:`,
          error
        );
        // Assuming results.errors might be needed by the calling context
      }
    }
    if (allProductData.length === 0) {
      logger.info('No products generated after distribution', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: true, phase: 'prepare' }),
      });
    }

    return allProductData;
  }

  async startProductsBatch({ sessionId, session, correlationId }) {
    const { logger, persistence, liferay, progress } = this.ctx;
    const {
      config,
      options,
      productDataList: allProductData,
    } = session.context;

    logger.info('Starting product batch processing', {
      sessionId,
      correlationId,
      nextStep: 'products',
    });

    if (!allProductData || allProductData.length === 0) {
      logger.info(
        'No products to create for this session. Marking step as BYPASSED.',
        { sessionId, correlationId }
      );
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH), // Generic ERC for an empty step
        sessionId,
        stepKey: 'products',
        status: 'BYPASSED',
      });
      return;
    }

    const useIndividualProductCreation = config.batchSize === 1 || allProductData.length === 1;

    if (useIndividualProductCreation) {
      for (const productData of allProductData) {
        const createdProduct = await this.createSingleProduct(config, productData, options);
        await persistence.createBatch({
          erc: createdProduct.externalReferenceCode || createERC(ERC_PREFIX.PRODUCT), // Use actual ERC if available
          sessionId,
          stepKey: 'products',
          status: 'SYNCHRONOUS',
          // Optional: Store product ID for future reference
          downstreamBatchId: createdProduct.id, 
        });
      }
    } else {
      const preparedProducts = allProductData.map((productData) => {
        if (!productData.externalReferenceCode) {
          productData.externalReferenceCode = createERC(ERC_PREFIX.PRODUCT);
        }
        const liferayProduct = {
          active: productData.active !== undefined ? productData.active : true,
          catalogId: parseInt(config.catalogId, 10),
          name: toI18n(productData.name),
          description: toI18n(productData.description),
          productType: productData.productType || 'simple',
          externalReferenceCode: productData.externalReferenceCode,
        };
        // Ensure product options and specifications are included if generated
        if (options.generateSkuVariants && productData.productOptions) {
          liferayProduct.productOptions = productData.productOptions;
        }
        if (
          options.generateSpecifications &&
          productData.productSpecifications
        ) {
          liferayProduct.productSpecifications =
            productData.productSpecifications;
        }
        if (
          productData.skus &&
          Array.isArray(productData.skus) &&
          productData.skus.length > 1
        ) {
          // Only include the base SKU (first one) in the initial product creation for products with variants.
          // All SKUs (variants) must be created in the 'product-skus' step
          // AFTER options have been linked.
          liferayProduct.skus = productData.skus.slice(0, 1);
        } else if (productData.skus) {
          liferayProduct.skus = productData.skus;
        }

        return liferayProduct;
      });

      const cleanedProducts = preparedProducts.map((product) => {
        const cleanProduct = { ...product };
        delete cleanProduct.images;
        delete cleanProduct.attachments;
        return cleanProduct;
      });

      const productBatches = [];
      const safeBatchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
      for (let i = 0; i < cleanedProducts.length; i += safeBatchSize) {
        productBatches.push(cleanedProducts.slice(i, i + safeBatchSize));
      }

      if (options.dryRun) {
        logger.info('DRY RUN: Skipping product creation batch submission.');
        for (const batch of productBatches) {
            const batchERC = createERC(ERC_PREFIX.PRODUCT_BATCH);
            logger.info({
                dryRunData: {
                    step: 'products',
                    count: batch.length,
                    payload: batch,
                },
            });
            await persistence.createBatch({
                erc: batchERC,
                sessionId,
                stepKey: 'products',
                status: 'SYNCHRONOUS',
            });
        }
        return;
      }

      const batchIds = [];
      for (
        let batchIndex = 0;
        batchIndex < productBatches.length;
        batchIndex++
      ) {
        const batch = productBatches[batchIndex];
        const batchERC = createERC(ERC_PREFIX.PRODUCT_BATCH);

        await persistence.createBatch({
          erc: batchERC,
          sessionId,
          stepKey: 'products', // Mark this batch as part of the 'products' step
          status: 'prepared',
        });

        const result = await liferay.createProductsBatch(config, batch, {
          externalReferenceCode: batchERC,
          sessionId,
        });
        const { batchId: bid } = result || {};

        if (!bid) {
          logger.error('Batch API did not return a batchId', {
            entityType: 'products',
            operation: 'generate',
            batchIndex,
            productCount: batch.length,
            status: result?.status,
          });
          await persistence.updateBatch(batchERC, { status: 'FAILED' });
          continue;
        }

        await persistence.updateBatch(batchERC, {
          status: 'SUBMITTED',
          downstreamBatchId: bid,
        });
        batchIds.push(bid);

        progress.batchStarted({
          sessionId,
          batchERC,
          batchId: bid,
          totalItems: batch.length,
          entityType: 'products',
          operation: 'generate',
          correlationId: correlationId,
        });
        logger.info('Product batch submitted', {
          batchERC,
          batchId: bid,
          productCount: batch.length,
        });
      }
      logger.info('All product batches submitted for processing', {
        sessionId,
        totalBatches: batchIds.length,
      });
    }
  }

  async _runAttachImagesStep(sessionId) {
    const { logger, media, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;

    logger.info('Starting attach images step', { sessionId });

    const withImages = (productDataList || []).filter(
      (p) => p.images?.length > 0
    );

    if (withImages.length > 0) {
      logger.info(
        `Processing ${withImages.length} products with image attachments`,
        { sessionId }
      );
      try {
        await media.createImages(config, withImages, options);
      } catch (error) {
        logger.error('Failed to process image attachments', {
          sessionId,
          error: error.message,
        });
      }
    } else {
      logger.info('No images to attach for this session.', { sessionId });
    }

    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'attach-images',
      status: 'SYNCHRONOUS',
    });
  }

  async _runAttachPdfsStep(sessionId) {
    const { logger, media, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;

    logger.info('Starting attach PDFs step', { sessionId });

    const withPdfs = (productDataList || []).filter(
      (p) => p.attachments?.length > 0
    );

    if (withPdfs.length > 0) {
      logger.info(
        `Processing ${withPdfs.length} products with PDF attachments`,
        { sessionId }
      );
      try {
        await media.createPdfs(config, withPdfs, options);
      } catch (error) {
        logger.error('Failed to process PDF attachments', {
          sessionId,
          error: error.message,
        });
      }
    } else {
      logger.info('No PDFs to attach for this session.', { sessionId });
    }

    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'attach-pdfs',
      status: 'SYNCHRONOUS',
    });
  }

  async _runUpdateInventoryStep(sessionId) {
    const { logger, liferay, persistence, progress } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;

    logger.info('Starting update inventory step (via batch UPSERT)', { sessionId });

    if (options.createWarehouses || (options.warehouses && options.warehouses.length > 0)) {
      try {
        const warehouses = options.warehouses || [];
        
        // Group items by warehouse
        const inventoryByWarehouse = new Map();

        for (const product of productDataList) {
          const skusToUpdate = [];

          if (product.skus && Array.isArray(product.skus)) {
            product.skus.forEach((s) => {
              if (s.sku) skusToUpdate.push(s);
            });
          } else if (product.sku || product.baseSku) {
            skusToUpdate.push({
              sku: product.sku || product.baseSku,
              quantity: product.quantity || 100,
            });
          }

          if (product.skuVariants && Array.isArray(product.skuVariants)) {
            product.skuVariants.forEach((v) => {
              if (v.sku) skusToUpdate.push(v);
            });
          }

          if (skusToUpdate.length === 0) continue;

          for (const warehouse of warehouses) {
            const warehouseERC = warehouse.externalReferenceCode || warehouse.erc;
            if (!warehouseERC) {
              logger.warn('Skipping warehouse with missing ERC', { warehouseId: warehouse.id });
              continue;
            }

            if (!inventoryByWarehouse.has(warehouseERC)) {
              inventoryByWarehouse.set(warehouseERC, []);
            }

            const items = inventoryByWarehouse.get(warehouseERC);

            for (const skuItem of skusToUpdate) {
              const qty = skuItem.quantity || skuItem.inventoryLevel || 100;
              const inventoryERC = `AICA-INV-${sanitizeForERC(warehouseERC, { max: 50, preserveUnderscore: true })}-${sanitizeForERC(skuItem.sku, { max: 50, preserveUnderscore: true })}`;
              
              items.push({
                externalReferenceCode: inventoryERC,
                sku: skuItem.sku,
                warehouseExternalReferenceCode: warehouseERC,
                quantity: qty,
              });
            }
          }
        }

        if (inventoryByWarehouse.size > 0) {
          logger.info(`Submitting batch inventory updates for ${inventoryByWarehouse.size} warehouses`, { sessionId });

          for (const [warehouseERC, items] of inventoryByWarehouse.entries()) {
            const batchERC = createERC(ERC_PREFIX.INVENTORY_BATCH);
            
            // Find the warehouse object to get its ID
            const warehouse = warehouses.find(w => (w.externalReferenceCode || w.erc) === warehouseERC);
            
            if (!warehouse) {
              logger.error(`Could not find warehouse with ERC ${warehouseERC} for inventory update`, { sessionId });
              continue;
            }

            await persistence.createBatch({
              erc: batchERC,
              sessionId,
              stepKey: 'update-inventory',
              status: 'prepared',
            });

            if (options.dryRun) {
              logger.info(`DRY RUN: Skipping inventory batch submission for warehouse ${warehouseERC}.`);
              await persistence.updateBatch(batchERC, { status: 'SYNCHRONOUS' });
              continue;
            }

            const result = await liferay.createWarehouseItemsBatch(config, items, {
              externalReferenceCode: batchERC,
              warehouseExternalReferenceCode: warehouseERC,
              warehouseId: warehouse.id,
              sessionId,
            });

            if (result?.batchId) {
              await persistence.updateBatch(batchERC, {
                status: 'SUBMITTED',
                downstreamBatchId: result.batchId,
              });

              progress.batchStarted({
                sessionId,
                batchERC,
                batchId: result.batchId,
                totalItems: items.length,
                entityType: 'inventory',
                operation: 'generate',
              });
            } else {
              await persistence.updateBatch(batchERC, { status: 'FAILED' });
            }
          }
        } else {
          logger.info('No inventory items to update.', { sessionId });
        }
      } catch (error) {
        logger.error('Failed to update inventory batch', {
          sessionId,
          error: error.message,
        });
      }
    } else {
      logger.info('Skipping inventory update.', { sessionId });
    }

    // Only create a synchronous batch marker if NO other batches were created for this step.
    const stepBatches = await persistence.getBatchesForSession(sessionId);
    const hasRealBatches = stepBatches.some(b => b.step_key === 'update-inventory');

    if (!hasRealBatches) {
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'update-inventory',
        status: 'SYNCHRONOUS',
      });
    }
  }
  
  async onSessionComplete({ sessionId, session, correlationId }) {
    const { logger, persistence, progress } = this.ctx;

    const dbSession = await persistence.getSession(sessionId);

    if (dbSession.status === 'completed' || dbSession.status === 'failed') {
      return;
    }

    logger.info('Generation session complete', {
      entityType: 'products',
      operation: 'generate',
      sessionId,
      correlationId,
    });

    progress.sessionCompleted({
      sessionId,
      correlationId,
    });

    await persistence.updateSessionStatus(sessionId, 'completed');
  }

  async processImageAndPDFAttachments(
    config,
    productDataList,
    options = {}
  ) {
    const { logger, liferay, media } = this.ctx;
    const { sessionId } = options;
    logger.info('Starting image and PDF attachment processing', {
      sessionId,
      productCount: productDataList.length,
    });
    const createdProducts = await liferay.getProducts(config);
    if (!createdProducts || createdProducts.length === 0) {
      logger.warn('No products found to process for attachments', {
        sessionId,
      });
      return;
    }
    const ercToProductMap = new Map();
    for (const product of createdProducts) {
      ercToProductMap.set(product.externalReferenceCode, product);
    }
    const productsToProcess = productDataList
      .map((originalProduct) => {
        const createdProduct = ercToProductMap.get(
          originalProduct.externalReferenceCode
        );
        if (createdProduct) {
          return {
            ...originalProduct,
            id: createdProduct.id,
          };
        }
        return null;
      })
      .filter(Boolean);
    const withImages = productsToProcess.filter((p) => p.images?.length > 0);
    const withPdfs = productsToProcess.filter((p) => p.attachments?.length > 0);
    if (withImages.length > 0) {
      logger.info(
        `Processing ${withImages.length} products with image attachments`,
        { sessionId }
      );
      try {
        await media.createImages(config, withImages, options);
      } catch (error) {
        logger.error('Failed to process image attachments', {
          sessionId,
          error: error.message,
        });
      }
    }
    if (withPdfs.length > 0) {
      logger.info(
        `Processing ${withPdfs.length} products with PDF attachments`,
        { sessionId }
      );
      try {
        await media.createPdfs(config, withPdfs, options);
      } catch (error) {
        logger.error('Failed to process PDF attachments', {
          sessionId,
          error: error.message,
        });
      }
    }
  }

  validateConfig(config) {
    const pollingRetriesValue = config.pollingRetries;
    if (pollingRetriesValue === undefined || pollingRetriesValue === null) {
      throw new Error('pollingRetries is required');
    }
    const pollingRetries = parseInt(pollingRetriesValue);
    if (isNaN(pollingRetries) || pollingRetries < 0 || pollingRetries > 20) {
      throw new Error('pollingRetries must be between 0 and 20');
    }
    const pollingDelayValue = config.pollingDelay;
    if (pollingDelayValue === undefined || pollingDelayValue === null) {
      throw new Error('pollingDelay is required');
    }
    const pollingDelay = parseInt(pollingDelayValue);
    if (isNaN(pollingDelay) || pollingDelay < 5000 || pollingDelay > 600000) {
      throw new Error('pollingDelay must be between 5 and 600 seconds');
    }
    const catalogIdValue = config.catalogId;
    if (catalogIdValue === undefined || catalogIdValue === null) {
      throw new Error('catalogId is required');
    }
    const catalogId = parseInt(catalogIdValue);
    if (isNaN(catalogId) || catalogId <= 0) {
      throw new Error('catalogId must be a positive integer');
    }
  }

  async validateOptions(config, options) {
    const { ai, logger } = this.ctx;

    if (
      !options.productCount ||
      typeof options.productCount !== 'number' ||
      options.productCount <= 0
    ) {
      throw new Error('Product count must be greater than 0');
    }

    if (!options.demoMode) {
      if (!config.aiModel) {
        const err = new Error(
          'AI model not configured. Please select an AI model in the AI Configuration object.'
        );
        err.statusCode = 400;
        logger.error(
          '✗ AI model validation failed for products: missing aiModel'
        );
        throw err;
      }

      await ai.getOpenAIClient(config);
    }

    if (
      (options.imageRatio ?? 0) > 0 &&
      options.imageMode !== 'none' &&
      !options.demoMode
    ) {
      if (!config.imageGenerationKey) {
        throw new Error(
          'Image generation API key not configured. Please set it in the AI Configuration object or disable image generation.'
        );
      }
    }
  }

  buildCategoryCounts(total, categories, mode = 'random', logger = null) {
    const counts = {};
    categories.forEach((c) => (counts[c] = 0));
    if (mode === 'even') {
      const base = Math.floor(total / categories.length);
      let remainder = total - base * categories.length;
      for (const c of categories) counts[c] = base;
      let i = 0;
      while (remainder-- > 0) {
        counts[categories[i % categories.length]]++;
        i++;
      }
      return counts;
    }
    for (let i = 0; i < total; i++) {
      const idx = Math.floor(Math.random() * categories.length);
      counts[categories[idx]]++;
    }
    if (logger) {
      logger.trace('Category distribution (random): ' + JSON.stringify(counts));
    }
    return counts;
  }
  
  async createCatalogOptions(config, options) {
    const { logger, liferay } = this.ctx;
    const categories = options.categories;
    logger.trace(
      `Creating catalog-level options for SKU variants... (Demo mode: ${options.demoMode})`
    );
    logger.trace(`Liferay URL: ${config.liferayUrl}`);
    logger.trace(`Categories to process: ${categories.join(', ')}`);
    const catalogOptions = {};
    const selectedLanguages = config.selectedLanguages || ['en-US'];
    const languageCodes = selectedLanguages.map((lang) =>
      lang.replace('-', '_')
    );
    const getOptionCharacteristics = (optionName, values) => {
      const name = optionName.toLowerCase();
      const characteristics = {
        fieldType: 'select',
        skuContributor: false,
        required: false,
        facetable: true,
      };

      // Determine initial characteristics based on name and values
      if (
        values.length <= 4 &&
        (name.includes('type') ||
          name.includes('style') ||
          name.includes('format') ||
          name.includes('edition'))
      ) {
        characteristics.fieldType = 'radio';
        characteristics.required = true;
        characteristics.skuContributor = true;
      }

      if (
        values.length === 2 &&
        (values.some(
          (v) =>
            v.toLowerCase().includes('yes') || v.toLowerCase().includes('no')
        ) ||
          values.some(
            (v) =>
              v.toLowerCase().includes('enabled') ||
              v.toLowerCase().includes('disabled')
          ))
      ) {
        characteristics.fieldType = 'checkbox';
      }

      if (
        name.includes('feature') ||
        name.includes('accessory') ||
        name.includes('addon')
      ) {
        characteristics.fieldType = 'checkbox_multiple';
      }

      if (
        name.includes('weight') ||
        name.includes('quantity') ||
        (name.includes('size') && values.some((v) => /\d/.test(v)))
      ) {
        characteristics.fieldType = 'numeric';
      }

      if (
        name.includes('custom') ||
        name.includes('personalization') ||
        name.includes('engraving')
      ) {
        characteristics.fieldType = 'text';
        characteristics.facetable = false;
      }

      if (
        name.includes('warranty') ||
        name.includes('delivery') ||
        name.includes('expiration')
      ) {
        characteristics.fieldType = 'date';
      }

      if (name.includes('schedule') || name.includes('appointment')) {
        characteristics.fieldType = 'select_date';
        characteristics.facetable = false;
      }

      if (
        name.includes('color') ||
        name.includes('size') ||
        name.includes('material')
      ) {
        characteristics.required = true;
        characteristics.facetable = true;
        characteristics.skuContributor = true;
      }

      // FINAL VALIDATION: Enforce Liferay Commerce Constraints
      
      // 1. If it's a SKU contributor, it must have an allowed field type.
      // If not, we disable SKU contribution to respect the detected field type.
      if (
        characteristics.skuContributor &&
        !COMMERCE_CONSTRAINTS.SKU_CONTRIBUTOR_FIELD_TYPES.includes(
          characteristics.fieldType,
        )
      ) {
        characteristics.skuContributor = false;
      }

      // 2. Ensure fieldType is in the valid list (sanity check)
      if (
        !COMMERCE_CONSTRAINTS.VALID_FIELD_TYPES.includes(
          characteristics.fieldType,
        )
      ) {
        characteristics.fieldType = 'select';
      }

      return characteristics;
    };
    const categoryOptionsMap = {
      Electronics: [
        { name: 'Color', values: ['Black', 'White', 'Silver', 'Space Gray'] },
        { name: 'Storage', values: ['64GB', '18GB', '256GB', '512GB', '1TB'] },
        { name: 'Screen Size', values: ['5.4"', '6.1"', '6.7"', '12.9"'] },
        {
          name: 'Connectivity',
          values: ['WiFi', 'Cellular', 'Bluetooth', 'USB-C'],
        },
      ],
      Clothing: [
        { name: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
        { name: 'Color', values: ['Black', 'White', 'Navy', 'Red', 'Gray'] },
        { name: 'Material', values: ['Cotton', 'Polyester', 'Wool', 'Silk'] },
        { name: 'Fit Type', values: ['Regular', 'Slim', 'Relaxed'] },
      ],
      'Home & Garden': [
        { name: 'Size', values: ['Small', 'Medium', 'Large', 'Extra Large'] },
        { name: 'Material', values: ['Wood', 'Metal', 'Plastic', 'Glass'] },
        { name: 'Weather Resistant', values: ['Yes', 'No'] },
        { name: 'Assembly Required', values: ['Yes', 'No'] },
      ],
    };
    let categoryOptions;
    for (const category of categories) {
      categoryOptions =
        categoryOptionsMap[category] || categoryOptionsMap['Electronics'];
      catalogOptions[category] = [];
      logger.trace(
        `Processing ${categoryOptions.length} options for category: ${category}`
      );
      for (const optionData of categoryOptions) {
        const optionERC = `OPT-${category.toUpperCase()}-${optionData.name
          .toUpperCase()
          .replace(/\s+/g, '_')}`;
        const optionCharacteristics = getOptionCharacteristics(
          optionData.name,
          optionData.values
        );
        const optionName = {};
        const optionDescription = {};
        languageCodes.forEach((langCode) => {
          const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
          optionName[langCode] = `${optionData.name}${suffix}`;
          optionDescription[
            langCode
          ] = `${optionData.name} option for ${category}${suffix}`;
        });
        const option = await liferay.createOptionWithReuse(config, {
          key: `${category.toLowerCase()}-${optionData.name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/&/g, 'and')}`,
          name: optionName,
          description: optionDescription,
          fieldType: optionCharacteristics.fieldType,
          facetable: optionCharacteristics.facetable,
          required: optionCharacteristics.required,
          skuContributor: optionCharacteristics.skuContributor,
          externalReferenceCode: optionERC,
        });
        logger.trace(
          `Created or reused option: ${option.name.en_US} (ID: ${option.id})`
        );
        logger.debug('Created/Reused Option', {
          category,
          optionData,
          option: {
            id: option.id,
            key: option.key,
            name: option.name,
            externalReferenceCode: option.externalReferenceCode,
          },
        });
        const optionValues = [];
        for (let i = 0; i < optionData.values.length; i++) {
          const values = Array.isArray(optionData.values)
            ? optionData.values
            : [];
          const value = values[i];
          const sanitizedValueForId = sanitizeForERC(value, { max: 20, preserveUnderscore: false });
          const valueERC = `VAL-${option.id}-${sanitizedValueForId
            .toUpperCase()
            .replace(/\s+/g, '_')}`;
          const valueName = {};
          languageCodes.forEach((langCode) => {
            const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
            valueName[langCode] = `${value}${suffix}`;
          });
          const optionValue = await liferay.createOptionValueWithReuse(
            config,
            option.id,
            {
              name: valueName,
              key: `${option.id}-${sanitizedValueForId
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/&/g, 'and')}`,
              priority: i + 1,
              externalReferenceCode: valueERC,
            }
          );
          optionValues.push(optionValue);
          logger.trace(
            `Created or reused option value: ${optionValue.name.en_US}`
          );
        }
        catalogOptions[category].push({ ...option, values: optionValues });
      }
    }
    return catalogOptions;
  }
  
  async createCatalogSpecifications(config, options) {
    const { logger, liferay } = this.ctx;
    const categories = options.categories;
    logger.trace(
      'Creating catalog-level specifications with option categories...'
    );
    const catalogSpecifications = {};
    const selectedLanguages = config.selectedLanguages || ['en-US'];
    const languageCodes = selectedLanguages.map((lang) =>
      lang.replace('-', '_')
    );

    const categoryGroupsMap = {
      Electronics: [
        {
          key: 'performance',
          title: 'Performance Specifications',
          description: 'Core performance and capability specifications',
          priority: 1,
        },
        {
          key: 'connectivity',
          title: 'Connectivity & Features',
          description: 'Connectivity options and additional features',
          priority: 2,
        },
        {
          key: 'physical',
          title: 'Physical Specifications',
          description:
            'Physical dimensions, weight, and material specifications',
          priority: 3,
        },
        {
          key: 'support',
          title: 'Support & Warranty',
          description: 'Warranty and support information',
          priority: 4,
        },
      ],
      Clothing: [
        {
          key: 'material-care',
          title: 'Material & Care',
          description: 'Fabric composition and care instructions',
          priority: 1,
        },
        {
          key: 'fit-style',
          title: 'Fit & Style',
          description: 'Fit type, style, and design specifications',
          priority: 2,
        },
        {
          key: 'details',
          title: 'Design Details',
          description: 'Specific design features and details',
          priority: 3,
        },
        {
          key: 'origin',
          title: 'Brand & Origin',
          description: 'Brand and manufacturing information',
          priority: 4,
        },
      ],
      'Home & Garden': [
        {
          key: 'dimensions-weight',
          title: 'Size & Weight',
          description: 'Physical dimensions and weight specifications',
          priority: 1,
        },
        {
          key: 'material-build',
          title: 'Materials & Construction',
          description: 'Materials used and construction details',
          priority: 2,
        },
        {
          key: 'features',
          title: 'Features & Capabilities',
          description: 'Product features and functional capabilities',
          priority: 3,
        },
        {
          key: 'care-warranty',
          title: 'Care & Warranty',
          description: 'Maintenance requirements and warranty information',
          priority: 4,
        },
      ],
    };

    let categorySpecificationsMap = {
      Electronics: [
        { key: 'screen-size', title: 'Screen Size', priority: 1, group: 'physical' },
        { key: 'battery-life', title: 'Battery Life', priority: 2, group: 'performance' },
        { key: 'processor', title: 'Processor', priority: 3, group: 'performance' },
        { key: 'ram', title: 'RAM', priority: 4, group: 'performance' },
        { key: 'warranty', title: 'Warranty', priority: 5, group: 'support' },
      ],
      Clothing: [
        { key: 'material', title: 'Material', priority: 1, group: 'material-care' },
        { key: 'care-instructions', title: 'Care Instructions', priority: 2, group: 'material-care' },
        { key: 'fit', title: 'Fit', priority: 3, group: 'fit-style' },
        { key: 'season', title: 'Season', priority: 4, group: 'fit-style' },
        { key: 'brand', title: 'Brand', priority: 5, group: 'origin' },
      ],
      'Home & Garden': [
        { key: 'dimensions', title: 'Dimensions', priority: 1, group: 'dimensions-weight' },
        { key: 'weight', title: 'Weight', priority: 2, group: 'dimensions-weight' },
        { key: 'material', title: 'Material', priority: 3, group: 'material-build' },
        { key: 'weather-resistance', title: 'Weather Resistance', priority: 4, group: 'features' },
        { key: 'assembly-required', title: 'Assembly Required', priority: 5, group: 'features' },
      ],
    };

    for (const category of categories) {
      const categoryGroups =
        categoryGroupsMap[category] || categoryGroupsMap['Electronics'];

      const resolveGroup = (proposedKey) => {
        if (!proposedKey)
          return (categoryGroups[0] && categoryGroups[0].key) || 'features';
        const exists = categoryGroups.find((g) => g.key === proposedKey);
        if (exists) return proposedKey;
        return (categoryGroups[0] && categoryGroups[0].key) || 'features';
      };

      let categorySpecs =
        categorySpecificationsMap[category] ||
        categorySpecificationsMap['Electronics'];

      const jsonDefs = specificationCatalog?.[category];
      if (jsonDefs && typeof jsonDefs === 'object') {
        const keys = Object.keys(jsonDefs);
        if (keys.length) {
          const lookup = new Map(
            (categorySpecificationsMap[category] || []).map((s) => [s.key, s])
          );
          const toTitle = (k) =>
            String(k)
              .split('-')
              .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
              .join(' ');
          categorySpecs = keys.map((key, idx) => {
            const known = lookup.get(key);
            return {
              key,
              title: known?.title || toTitle(key),
              priority: known?.priority || idx + 1,
              group: resolveGroup(known?.group || 'features'),
            };
          });
        }
      }
      catalogSpecifications[category] = [];
      const optionCategories = {};
      let createdSpecCount = 0;

      for (const groupData of categoryGroups) {
        try {
          const categoryERC = buildOptionCategoryERC(category, groupData.key);
          const categoryTitle = {};
          const categoryDescription = {};
          languageCodes.forEach((langCode) => {
            const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
            categoryTitle[langCode] = `${groupData.title}${suffix}`;
            categoryDescription[langCode] = `${groupData.description}${suffix}`;
          });

          const optionCategory = await liferay.createOptionCategoryWithReuse(
            config,
            {
              key: `${category.toLowerCase()}-${groupData.key}`,
              title: categoryTitle,
              description: categoryDescription,
              priority: groupData.priority,
              externalReferenceCode: categoryERC,
            }
          );

          if (optionCategory) {
            logger.trace(
              `Using option category: ${
                optionCategory.title.en_US || optionCategory.key
              } (ID: ${optionCategory.id})`
            );
            logger.debug('Created/Reused Option Category', {
              category: category,
              groupData: groupData,
              optionCategory: {
                id: optionCategory.id,
                key: optionCategory.key,
                title: optionCategory.title,
                externalReferenceCode: optionCategory.externalReferenceCode,
              },
            });
            optionCategories[groupData.key] = optionCategory;
          } else {
            logger.warn(
              `Could not create or retrieve option category for key: ${groupData.key}`
            );
          }
        } catch (error) {
          logger.error(
            `Failed to process option category ${groupData.title} for ${category}:`,
            error
          );
        }
      }

      for (const specData of categorySpecs) {
        try {
          const specERC = buildSpecificationERC(category, specData.key);
          const specTitle = {};
          languageCodes.forEach((langCode) => {
            const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
            specTitle[langCode] = `${specData.title}${suffix}`;
          });

          const linkedOptionCategory =
            optionCategories[resolveGroup(specData.group)];

          logger.debug('Preparing Specification Payload', {
            category,
            specData,
            linkedOptionCategory: linkedOptionCategory
              ? {
                  id: linkedOptionCategory.id,
                  externalReferenceCode: linkedOptionCategory.externalReferenceCode,
                  key: linkedOptionCategory.key,
                  title: linkedOptionCategory.title,
                }
              : null,
          });

          const specificationPayload = {
            key: `${category.toLowerCase()}-${specData.key}`,
            title: specTitle,
            facetable: true,
            priority: specData.priority,
            externalReferenceCode: specERC,
          };
          if (linkedOptionCategory) {
            specificationPayload.optionCategory = {
              id: linkedOptionCategory.id,
              externalReferenceCode: linkedOptionCategory.externalReferenceCode,
              key: linkedOptionCategory.key,
              title: linkedOptionCategory.title,
            };
          }

          const specification = await liferay.rest.createSpecificationWithReuse(
            config,
            specificationPayload
          );
          logger.trace(
            `Created or reused specification: ${
              specification.title?.en_US || specification.key
            } (ID: ${specification.id})`
          );
          logger.debug('Created/Reused Specification', {
            category,
            specData,
            specification: {
              id: specification.id,
              key: specification.key,
              title: specification.title,
              externalReferenceCode: specification.externalReferenceCode,
              optionCategoryId: specification.optionCategoryId,
            },
          });

          if (linkedOptionCategory) {
            const desiredId = linkedOptionCategory.id;
            const desiredERC = linkedOptionCategory.externalReferenceCode;
            const currentId =
              specification.optionCategoryId ||
              specification.optionCategory?.id;
            const currentERC =
              specification.optionCategoryExternalReferenceCode ||
              specification.optionCategory?.externalReferenceCode;

            if (
              (desiredId && desiredId !== currentId) ||
              (!desiredId && desiredERC && desiredERC !== currentERC)
            ) {
              try {
                if (desiredId) {
                  await liferay.updateSpecificationByERC(config, specERC, {
                    optionCategory: {
                      id: desiredId,
                      title: linkedOptionCategory.title,
                    },
                  });
                } else if (desiredERC) {
                  await liferay.updateSpecificationByERC(config, specERC, {
                    optionCategory: {
                      externalReferenceCode: desiredERC,
                      title: linkedOptionCategory.title,
                    },
                  });
                }
                specification.optionCategoryId =
                  desiredId || specification.optionCategoryId;
                if (desiredERC)
                  specification.optionCategoryExternalReferenceCode =
                    desiredERC;
                logger.trace(
                  `Linked specification ${specERC} to option category ${
                    desiredId ? `ID ${desiredId}` : desiredERC
                  }`
                );
              } catch (patchErr) {
                logger.warn(
                  `Failed to patch option category link for ${specERC}: ${patchErr.message}`
                );
              }
            }
          }

          catalogSpecifications[category].push(specification);
          createdSpecCount++;
        } catch (error) {
          logger.error(
            `Failed to process specification ${specData.title} for ${category}:`,
            {
              message: error.message,
              stack: error.stack,
              errors: error.errors,
            }
          );
        }
      }

      logger.info(
        `Option categories ready for ${category}: ${
          Object.keys(optionCategories).length
        }`
      );

      logger.info(
        `Created/reused ${createdSpecCount} specifications for category: ${category}`
      );

      try {
        const prefix = `${String(category).toLowerCase()}-`;
        const listed = await liferay.getSpecifications(config, {
          search: prefix,
          pageSize: 200,
          fields: 'id,key,externalReferenceCode',
        });
        const items = Array.isArray(listed?.items) ? listed.items : [];
        logger.info(
          `Verification: ${items.length} specifications found matching prefix '${prefix}'`
        );
      } catch (verifyErr) {
        logger.warn(
          `Verification list for specifications failed: ${verifyErr.message}`
        );
      }

      logger.info(
        `Processed ${catalogSpecifications[category].length} specifications for category: ${category}`
      );
    }

    return catalogSpecifications;
  }
  async createBasicProduct(config, productData, options) {
    const { logger, liferay } = this.ctx;
    const {
      name,
      description,
      productType,
      externalReferenceCode,
      catalogId,
      category,
      skus,
    } = productData;

    const payload = {
      active: true,
      catalogId: parseInt(config.catalogId, 10),
      name: toI18n(name),
      description: toI18n(description),
      productType: productType || 'simple',
      externalReferenceCode:
        externalReferenceCode || createERC(ERC_PREFIX.PRODUCT),
    };

    if (skus && Array.isArray(skus)) {
      payload.skus = skus.slice(0, 1);
    }

    const createdProduct = await liferay.createProduct(config, payload);
    logger.info(`Created product: ${createdProduct.name?.en_US || 'N/A'}`, {
      productId: createdProduct.id,
    });
    return createdProduct;
  }
  async createSingleProduct(config, productData, options) {
    const { logger, liferay } = this.ctx;
    const {
      name,
      description,
      productType,
      externalReferenceCode,
      catalogId,
      category,
      productOptions,
      productSpecifications,
      skus,
    } = productData;

    const payload = {
      active: true,
      catalogId: parseInt(config.catalogId, 10),
      name: toI18n(name),
      description: toI18n(description),
      productType: productType || 'simple',
      externalReferenceCode:
        externalReferenceCode || createERC(ERC_PREFIX.PRODUCT),
      productOptions: productOptions || [],
      productSpecifications: productSpecifications || [],
    };

    if (skus && Array.isArray(skus)) {
      payload.skus = skus.slice(0, 1);
    }

    const createdProduct = await liferay.createProduct(config, payload);
    logger.info(`Created product: ${createdProduct.name?.en_US || 'N/A'}`, {
      productId: createdProduct.id,
    });
    return createdProduct;
  }
  async updateInventory(config, createdProduct, originalProduct, options) {
    const { logger, liferay } = this.ctx;
    const { warehouses } = options;

    if (!warehouses || warehouses.length === 0) {
      logger.warn('No warehouses available to update inventory for', {
        productId: createdProduct.id,
      });
      return;
    }

    for (const warehouse of warehouses) {
      try {
        await liferay.updateInventory(
          config,
          warehouse.id,
          createdProduct.id,
          {
            sku: originalProduct.sku,
            quantity: originalProduct.quantity,
            neverExpire: true,
          }
        );
        logger.info(
          `Updated inventory for product ${createdProduct.id} in warehouse ${warehouse.id}`
        );
      } catch (error) {
        logger.error(
          `Failed to update inventory for product ${createdProduct.id} in warehouse ${warehouse.id}`,
          { error: error.message }
        );
      }
    }
  }
}

module.exports = ProductGenerator;
