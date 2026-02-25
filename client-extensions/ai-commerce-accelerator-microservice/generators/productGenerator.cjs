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
const { ERC_PREFIX, ENV } = require('../utils/constants.cjs');
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
      'generate-price-lists': this._runGeneratePriceListsStep.bind(this),
      'generate-bulk-pricing': this._runGenerateBulkPricingStep.bind(this),
      'generate-tier-pricing': this._runGenerateTierPricingStep.bind(this),
      'attach-images': this._runAttachImagesStep.bind(this),
      'attach-pdfs': this._runAttachPdfsStep.bind(this),
      'update-inventory': this._runUpdateInventoryStep.bind(this),
    };
  }

  async generateProducts(config, options) {
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
    ];

    if (options.generatePriceLists) {
      steps.push({ name: 'generate-price-lists', type: 'sync' });
    }

    if (options.generateBulkPricing) {
      steps.push({ name: 'generate-bulk-pricing', type: 'sync' });
    }

    if (options.generateTierPricing) {
      steps.push({ name: 'generate-tier-pricing', type: 'sync' });
    }

    steps.push({
      type: 'parallel',
      steps: [
        { name: 'attach-images', type: 'sync' },
        { name: 'attach-pdfs', type: 'sync' },
        { name: 'update-inventory', type: 'sync' },
      ],
    });

    await persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
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

  async _runGeneratePriceListsStep(sessionId) {
    return this._runPricingStep(sessionId, 'generate-price-lists', (e) => !e.bulkPricing && (!e.tierPrices || e.tierPrices.length === 0));
  }

  async _runGenerateBulkPricingStep(sessionId) {
    return this._runPricingStep(sessionId, 'generate-bulk-pricing', (e) => e.bulkPricing === true);
  }

  async _runGenerateTierPricingStep(sessionId) {
    return this._runPricingStep(sessionId, 'generate-tier-pricing', (e) => !e.bulkPricing && e.tierPrices && e.tierPrices.length > 0);
  }

  async _runPricingStep(sessionId, stepKey, filterFn) {
    const { logger, liferay, persistence, progress } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;

    logger.info(`Starting ${stepKey} step`, { sessionId });

    try {
      await this._ensurePriceLists(config, sessionId);

      const entries = [];
      for (const product of productDataList) {
        // Determine promotion status once per product for consistency across variants
        const productHasPromotion = Math.random() < ENV.PRICING_PROMOTION_RATIO;

        if (Array.isArray(product.priceEntries)) {
          for (const entry of product.priceEntries) {
            // Determine if this specific entry should be included in this step
            const isMatch = filterFn(entry);
            if (!isMatch) continue;

            const baseErc = entry.externalReferenceCode || uuidv4();
            const hasBulkOrTier = entry.tierPrices && entry.tierPrices.length > 0;

            // Apply distribution rules:
            // - Bulk Pricing: 15% (if step is generate-bulk-pricing)
            // - Tiered Pricing: 15% (if step is generate-tier-pricing)
            
            let shouldInclude = true;
            if (stepKey === 'generate-bulk-pricing' || stepKey === 'generate-tier-pricing') {
              // Only apply to a subset of products that actually have tier data from AI
              if (!hasBulkOrTier) {
                shouldInclude = false;
              } else {
                // Force distribution based on config
                const ratio = stepKey === 'generate-bulk-pricing' 
                  ? ENV.PRICING_BULK_RATIO 
                  : ENV.PRICING_TIER_RATIO;
                shouldInclude = Math.random() < ratio;
              }
            }

            if (shouldInclude) {
              const skuERC = entry.skuExternalReferenceCode || (typeof entry.sku === 'string' ? entry.sku : null);
              const skuData = typeof entry.sku === 'object' ? entry.sku : {
                basePrice: entry.price,
                basePromoPrice: entry.promoPrice || null,
              };

              // Main entry for GENERAL list
              entries.push({
                price: entry.price,
                sku: skuData,
                skuExternalReferenceCode: skuERC,
                bulkPricing: stepKey === 'generate-bulk-pricing',
                tierPrices: (entry.tierPrices || []).map(tp => ({
                  minimumQuantity: tp.minimumQuantity,
                  price: tp.price,
                  externalReferenceCode: tp.externalReferenceCode
                })),
                priceListExternalReferenceCode: 'AICA-PL-GENERAL',
                externalReferenceCode: `PE-${skuERC}-GEN-${sanitizeForERC(baseErc, { max: 40 })}`,
              });

              // Separate entry for PROMOTIONS list if promoPrice exists AND product passes probability check
              if ((skuData.basePromoPrice || entry.promoPrice) && productHasPromotion) {
                const promoPrice = skuData.basePromoPrice || entry.promoPrice;
                entries.push({
                  price: promoPrice,
                  sku: {
                    ...skuData,
                    basePrice: promoPrice, // Use promo price as the base in the promotion list
                    basePromoPrice: null,
                  },
                  skuExternalReferenceCode: skuERC,
                  bulkPricing: stepKey === 'generate-bulk-pricing',
                  tierPrices: (entry.tierPrices || []).map(tp => ({
                    minimumQuantity: tp.minimumQuantity,
                    price: tp.promoPrice || tp.price,
                    externalReferenceCode: tp.externalReferenceCode
                  })),
                  priceListExternalReferenceCode: 'AICA-PL-PROMOTIONS',
                  externalReferenceCode: `PE-${skuERC}-PROM-${sanitizeForERC(baseErc, { max: 40 })}`,
                });
              }
            }
          }
        }
      }

    if (entries.length > 0) {
      // Group entries by priceListExternalReferenceCode for scoped batch submission
      const entriesByPriceList = entries.reduce((acc, entry) => {
        const plERC = entry.priceListExternalReferenceCode;
        if (!acc[plERC]) acc[plERC] = [];
        acc[plERC].push(entry);
        return acc;
      }, {});

      for (const [plERC, plEntries] of Object.entries(entriesByPriceList)) {
        logger.info(
          `Submitting ${plEntries.length} price entries for ${stepKey} (Price List: ${plERC}) via batch API`,
          { sessionId }
        );

        const batchERC = createERC(ERC_PREFIX.PRICEENTRY_BATCH);

        await persistence.createBatch({
          erc: batchERC,
          sessionId,
          stepKey,
          status: 'prepared',
        });

        const result = await liferay.createPriceEntriesBatch(config, plEntries, {
          externalReferenceCode: batchERC,
          priceListExternalReferenceCode: plERC,
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
            totalItems: plEntries.length,
            entityType: 'products',
            operation: 'generate',
            correlationId: config.correlationId,
          });
        } else {
          logger.error(
            `Failed to submit price entries batch for ${stepKey} (PL: ${plERC})`,
            { sessionId, batchERC }
          );
          await persistence.updateBatch(batchERC, { status: 'FAILED' });
        }
      }
    } else {
        logger.info(`No price entries for ${stepKey}. Marking as SYNCHRONOUS.`, { sessionId });
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH),
          sessionId,
          stepKey: stepKey,
          status: 'SYNCHRONOUS',
          totalCount: 0,
          processedCount: 0,
        });
      }
    } catch (error) {
      logger.error(`Error in ${stepKey} step: ${error.message}`, { sessionId, error });
      throw error;
    }
  }

  async _ensurePriceLists(config, sessionId) {
    const { logger, liferay } = this.ctx;
    const PRICE_LISTS = [
      { erc: 'AICA-PL-GENERAL', name: 'AI Commerce Accelerator Price List', priority: 1.0, type: 'price-list' },
      { erc: 'AICA-PL-PROMOTIONS', name: 'AI Commerce Accelerator Promotions', priority: 2.0, type: 'promotion' }
    ];

    for (const pl of PRICE_LISTS) {
      try {
        const existing = await liferay.getPriceListByERC(config, pl.erc);
        if (!existing) {
          logger.info(`Creating missing price list: ${pl.name} (${pl.type})`, { sessionId });
          await liferay.createPriceList(config, {
            externalReferenceCode: pl.erc,
            name: pl.name,
            currencyCode: config.currencyCode || 'USD',
            active: true,
            priority: pl.priority,
            catalogId: config.catalogId,
            type: pl.type
          });
        }
      } catch (err) {
        logger.error(`Failed to ensure price list ${pl.erc} exists`, { sessionId, error: err.message });
        throw err;
      }
    }
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
      const resolvedItems = await liferay.resolveByERCsWithRetry(
        config,
        ercs,
        (cfg, e) => liferay.getProductsByERC(cfg, e, ['id', 'externalReferenceCode', 'productId']),
        { label: 'products' }
      );
      
      const ercToIdMap = new Map();
      (resolvedItems || []).forEach(item => {
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
      const resolvedItems = await liferay.resolveByERCsWithRetry(
        config,
        ercs,
        (cfg, e) => liferay.getWarehousesByERC(cfg, e, ['id', 'externalReferenceCode', 'name']),
        { label: 'warehouses' }
      );
      
      const ercToIdMap = new Map();
      (resolvedItems || []).forEach(item => {
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

    try {
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
            
            // Strip internal/read-only properties before sending to Liferay
            const cleanedOptions = product.productOptions.map((opt) => {
              const cleanOpt = { ...opt };
              delete cleanOpt.id;
              delete cleanOpt.__catalogOption;
              return cleanOpt;
            });

            await liferay.addProductOptions(config, product.id, cleanedOptions);
            logger.trace(`Linked ${cleanedOptions.length} options to product ${product.id}`, { sessionId });
          } catch (error) {
            logger.error(`Failed to link options for product ${product.id}`, {
              sessionId,
              error: error.message,
            });
            // Individual product failure doesn't necessarily fail the whole step, 
            // but we log it.
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
    } catch (error) {
      logger.error('Failed execution of link-product-options step', {
        sessionId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'link-product-options',
        status: 'FAILED',
      });
    }
  }

  async _runProductSkusStep(sessionId) {
    const { logger, liferay, persistence, progress } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, productDataList, options } = session.context;

    logger.info('Starting variant SKUs creation step (via Product UPSERT batch)', { sessionId });

    const preparedProducts = (productDataList || []).filter(
      p => Array.isArray(p.skus) && p.skus.length > 0
    ).map((productData) => {
      const liferayProduct = {
        active: productData.active !== undefined ? productData.active : true,
        catalogId: parseInt(config.catalogId, 10),
        name: toI18n(productData.name),
        description: toI18n(productData.description),
        productType: productData.productType || 'simple',
        externalReferenceCode: productData.externalReferenceCode,
        productConfiguration: {
          allowBackOrder: productData.allowBackOrder || false,
        },
        skus: productData.skus,
      };
      
      if (options.generateSkuVariants && productData.productOptions) {
        liferayProduct.productOptions = productData.productOptions;
      }
      if (options.generateSpecifications && productData.productSpecifications) {
        liferayProduct.productSpecifications = productData.productSpecifications;
      }

      return this._cleanProductForLiferay(liferayProduct, { stripSkuOptions: false });
    });

    if (preparedProducts.length > 0) {
      const safeBatchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
      for (let i = 0; i < preparedProducts.length; i += safeBatchSize) {
        const batch = preparedProducts.slice(i, i + safeBatchSize);
        const batchERC = createERC(ERC_PREFIX.PRODUCT_BATCH);

        await persistence.createBatch({
          erc: batchERC,
          sessionId,
          stepKey: 'product-skus',
          status: 'prepared',
        });

        const result = await liferay.createProductsBatch(config, batch, {
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
            totalItems: batch.length,
            entityType: 'products',
            operation: 'generate',
            correlationId: config.correlationId,
          });
        } else {
          logger.error(`Failed to submit SKU update batch ${i / safeBatchSize + 1}`, { sessionId, batchERC });
          await persistence.updateBatch(batchERC, { status: 'FAILED' });
        }
      }
    } else {
      logger.info('No variant SKUs to create. Marking step as SYNCHRONOUS.', { sessionId });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'product-skus',
        status: 'SYNCHRONOUS',
        totalCount: 0,
        processedCount: 0,
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
      const error = new Error('No product data generated. Workflow cannot continue.');
      logger.error(error.message, { sessionId });
      throw error;
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
    await this.startProductsBatch({
      sessionId,
      session,
      correlationId: session.correlationId,
    });
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

    const enableBackorders = options.enableBackorders === true || options.enableBackorders === 'true';
    const backorderRatio = options.backorderAssignmentRatio !== undefined ? parseFloat(options.backorderAssignmentRatio) : 0;

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
          productDataList = await mockData.generateProductData(
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
            config.selectedLanguages || ['en-US'],
            options
          );
        }
        if (options.generateSkuVariants || options.generateSpecifications) {
          const catOpts = catalogOptionsByCategory[category] || [];
          const catSpecs = catalogSpecificationsByCategory[category] || [];
                      for (const pd of productDataList) {
                        if (!pd.externalReferenceCode) {
                          pd.externalReferenceCode = createERC(ERC_PREFIX.PRODUCT);
                        }
                        pd.__catalogOptions = catOpts;
                        pd.__catalogSpecifications = catSpecs;            pd.category = category;

            // Apply backorder logic
            if (enableBackorders) {
              pd.allowBackOrder = backorderRatio >= 100 || Math.random() * 100 <= backorderRatio;
            } else {
              pd.allowBackOrder = false;
            }

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
                      __catalogOption: catalogOption, // Keep reference for value lookups
                    };
                  }
                  
                  if (option.fieldType) {
                    return {
                      name: option.name,
                      fieldType: option.fieldType,
                      skuContributor: !!option.skuContributor,
                      required: true,
                    };
                  }

                  return null;
                })
                .filter(Boolean);

              // Infer product type
              const hasSkuContributor = (pd.productOptions || []).some(opt => opt.skuContributor);
              if (hasSkuContributor) {
                pd.productType = 'simple';
              }

              if (pd.skuVariants && Array.isArray(pd.skuVariants)) {
                const seenSkuOptions = new Set();
                const variantSkus = pd.skuVariants
                  .map((variant) => {
                    const skuOptions = [];
                    
                    for (const [optName, valName] of Object.entries(variant.options || {})) {
                      // Find the enriched option metadata we just built
                      const productOption = (pd.productOptions || []).find(
                        (po) => {
                          const name =
                            typeof po.name === 'object'
                              ? po.name.en_US
                              : po.name;
                          return (
                            name === optName ||
                            name?.toLowerCase() === optName.toLowerCase() ||
                            po.key === optName
                          );
                        }
                      );

                      if (productOption && productOption.skuContributor && productOption.optionId) {
                        const catalogOption = productOption.__catalogOption;
                        const values = catalogOption?.optionValues || catalogOption?.values || [];
                        
                        const catalogValue = values.find(
                          (v) =>
                            v.name?.en_US === valName ||
                            v.name === valName ||
                            v.name?.en_US?.toLowerCase() === valName.toLowerCase() ||
                            v.key === valName.toLowerCase()
                        );

                        if (catalogValue) {
                          skuOptions.push({
                            key: productOption.key,
                            optionId: productOption.optionId,
                            optionValueId: catalogValue.id,
                            value: catalogValue.key,
                          });
                        }
                      }
                    }

                    if (skuOptions.length === 0) return null;

                    // Deduplicate
                    const comboKey = skuOptions
                      .sort((a, b) => a.optionId - b.optionId)
                      .map((o) => `${o.optionId}:${o.optionValueId}`)
                      .join('|');

                    if (seenSkuOptions.has(comboKey)) return null;
                    seenSkuOptions.add(comboKey);

                    return {
                      sku: variant.sku,
                      externalReferenceCode: createERC(ERC_PREFIX.SKU),
                      price: variant.price,
                      published: variant.published !== undefined ? variant.published : true,
                      purchasable: variant.purchasable !== undefined ? variant.purchasable : true,
                      neverExpire: variant.neverExpire !== undefined ? variant.neverExpire : true,
                      inventoryLevel: variant.inStock ? 50 : 0,
                      skuOptions,
                    };
                  })
                  .filter((v) => v !== null);

                if (variantSkus.length > 0) {
                  pd.skus = variantSkus;
                  logger.trace(
                    `Replaced base SKU with ${variantSkus.length} unique variant SKUs for product ${pd.externalReferenceCode}`,
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
                logger.errorWithStack(error, {
                  category,
                  message: `Failed to generate products for category ${category}`,
                });
                throw error;
              }    }
    if (allProductData.length === 0) {
      logger.info('No products generated after distribution', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: true, phase: 'prepare' }),
      });
    }

    return allProductData;
  }

  _cleanProductForLiferay(product, options = {}) {
    const { stripSkuOptions = false } = options;
    const cleanProduct = { ...product };

    // Remove internal/read-only fields from the top level
    delete cleanProduct.id;
    delete cleanProduct.productId;
    delete cleanProduct.images;
    delete cleanProduct.attachments;
    delete cleanProduct.category;
    delete cleanProduct.__catalogOptions;
    delete cleanProduct.__catalogSpecifications;
    delete cleanProduct.options; // AI-generated raw options
    delete cleanProduct.specifications; // AI-generated raw specs
    delete cleanProduct.skuVariants; // Internal variant tracking

    // Deep clean productOptions
    if (Array.isArray(cleanProduct.productOptions)) {
      cleanProduct.productOptions = cleanProduct.productOptions.map((opt) => {
        const cleanOpt = { ...opt };
        delete cleanOpt.id; // Read-only in ProductOption
        delete cleanOpt.__catalogOption; // Internal helper
        return cleanOpt;
      });
    }

    // Deep clean productSpecifications
    if (Array.isArray(cleanProduct.productSpecifications)) {
      cleanProduct.productSpecifications = cleanProduct.productSpecifications.map(
        (spec) => {
          const cleanSpec = { ...spec };
          delete cleanSpec.id; // Read-only
          delete cleanSpec.productId; // Derived
          return cleanSpec;
        },
      );
    }

    // Deep clean SKUs
    if (Array.isArray(cleanProduct.skus)) {
      cleanProduct.skus = cleanProduct.skus.map((sku) => {
        const cleanSku = { ...sku };
        if (stripSkuOptions) {
          delete cleanSku.skuOptions;
        }
        delete cleanSku.id; // Read-only
        delete cleanSku.active; // Not supported in Sku DTO (use published/purchasable)
        delete cleanSku.inventoryLevel; // Read-only in Sku DTO (use inventory API)
        delete cleanSku.productName; // Read-only
        delete cleanSku.unitOfMeasureKey; // Read-only
        delete cleanSku.unitOfMeasureName; // Read-only
        delete cleanSku.unitOfMeasureSkuId; // Read-only
        delete cleanSku.inStock; // Derived
        return cleanSku;
      });
    }

    return cleanProduct;
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
          productConfiguration: {
            allowBackOrder: productData.allowBackOrder || false,
          },
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

        const hasSkuContributors = (productData.productOptions || []).some(
          (opt) => opt.skuContributor
        );

        if (
          options.generateSkuVariants &&
          hasSkuContributors &&
          productData.skus?.length > 0
        ) {
          // Omit SKUs for products that will have variants.
          // They will be created in the 'product-skus' step after options are linked.
          // This prevents issues where the base SKU created here cannot be updated with option links later.
          delete liferayProduct.skus;
        } else if (
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

        // Initially strip skuOptions as they require the options to be linked first
        return this._cleanProductForLiferay(liferayProduct, {
          stripSkuOptions: true,
        });
      });

      const productBatches = [];
      const safeBatchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
      for (let i = 0; i < preparedProducts.length; i += safeBatchSize) {
        productBatches.push(preparedProducts.slice(i, i + safeBatchSize));
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

    try {
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
    } catch (error) {
      logger.error('Failed execution of attach-images step', {
        sessionId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'attach-images',
        status: 'FAILED',
      });
    }
  }

  async _runAttachPdfsStep(sessionId) {
    const { logger, media, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;

    logger.info('Starting attach PDFs step', { sessionId });

    try {
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
    } catch (error) {
      logger.error('Failed execution of attach-pdfs step', {
        sessionId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'attach-pdfs',
        status: 'FAILED',
      });
    }
  }

  async _runUpdateInventoryStep(sessionId) {
    const { logger, liferay, persistence, progress } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;

    logger.info('Starting update inventory step (via batch UPSERT)', { sessionId });

    try {
      const assignmentRatio = options.inventoryAssignmentRatio !== undefined ? parseFloat(options.inventoryAssignmentRatio) : 100;
      const minQty = options.inventoryMin !== undefined ? parseInt(options.inventoryMin, 10) : 10;
      const maxQty = options.inventoryMax !== undefined ? parseInt(options.inventoryMax, 10) : 100;

      if (options.createWarehouses || (options.warehouses && options.warehouses.length > 0)) {
        try {
          const warehouses = options.warehouses || [];
          
          // Group items by warehouse and deduplicate by inventoryERC
          // Map<warehouseERC, Map<inventoryERC, item>>
          const inventoryByWarehouse = new Map();

          for (const product of productDataList) {
            // Apply assignment ratio check per product
            if (assignmentRatio < 100 && Math.random() * 100 > assignmentRatio) {
              continue;
            }

            // Prioritize variants, fallback to base SKU
            const sourceSkus = (product.skus && product.skus.length > 0)
              ? product.skus
              : (product.sku || product.baseSku)
                ? [{ sku: product.sku || product.baseSku, quantity: product.quantity || product.inventoryLevel }]
                : [];

            if (sourceSkus.length === 0) continue;

            for (const warehouse of warehouses) {
              const warehouseERC = warehouse.externalReferenceCode || warehouse.erc;
              if (!warehouseERC) {
                logger.warn('Skipping warehouse with missing ERC', { warehouseId: warehouse.id });
                continue;
              }

              if (!inventoryByWarehouse.has(warehouseERC)) {
                inventoryByWarehouse.set(warehouseERC, new Map());
              }

              const warehouseItemsMap = inventoryByWarehouse.get(warehouseERC);

              for (const skuItem of sourceSkus) {
                if (!skuItem.sku) continue;

                let qty = skuItem.quantity || skuItem.inventoryLevel;
                
                if (qty === undefined || qty === null) {
                  // Generate random quantity within range
                  qty = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
                }

                const inventoryERC = `AICA-INV-${sanitizeForERC(warehouseERC, { max: 50, preserveUnderscore: true })}-${sanitizeForERC(skuItem.sku, { max: 50, preserveUnderscore: true })}`;
                
                if (warehouseItemsMap.has(inventoryERC)) {
                  // Sum quantities for duplicates to ensure total count is preserved
                  const existing = warehouseItemsMap.get(inventoryERC);
                  existing.quantity = (existing.quantity || 0) + qty;
                } else {
                  warehouseItemsMap.set(inventoryERC, {
                    externalReferenceCode: inventoryERC,
                    sku: skuItem.sku,
                    warehouseExternalReferenceCode: warehouseERC,
                    quantity: qty,
                  });
                }
              }
            }
          }

          if (inventoryByWarehouse.size > 0) {
            logger.info(`Submitting batch inventory updates for ${inventoryByWarehouse.size} warehouses`, { sessionId });

            for (const [warehouseERC, itemsMap] of inventoryByWarehouse.entries()) {
              const items = Array.from(itemsMap.values());
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
                status: 'PREPARED',
              });

              if (options.dryRun) {
                logger.info(`DRY RUN: Skipping inventory batch submission for warehouse ${warehouseERC}.`);
                await persistence.updateBatch(batchERC, { status: 'SYNCHRONOUS' });
                continue;
              }

              let result;
              try {
                result = await liferay.createWarehouseItemsBatch(config, items, {
                  externalReferenceCode: batchERC,
                  warehouseExternalReferenceCode: warehouseERC,
                  warehouseId: warehouse.id,
                  sessionId,
                });
              } catch (batchError) {
                logger.error(`Critical error submitting inventory batch for warehouse ${warehouseERC}`, { 
                  sessionId, 
                  batchERC,
                  error: batchError.message 
                });
                await persistence.updateBatch(batchERC, { status: 'FAILED' });
                continue;
              }

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
                  correlationId: config.correlationId,
                });
              } else {
                logger.error(`Failed to submit inventory batch for warehouse ${warehouseERC}`, { sessionId, batchERC });
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
          // Non-critical error within the warehouse loop, but we log it.
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
    } catch (error) {
      logger.error('Failed execution of update-inventory step', {
        sessionId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'update-inventory',
        status: 'FAILED',
      });
    }
  }

  async createCatalogOptions(config, options) {
    const { logger, liferay } = this.ctx;
    const categories = options.categories;
    logger.trace(
      `Creating catalog-level options for SKU variants... (Demo mode: ${options.demoMode})`
    );
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

      if (
        characteristics.skuContributor &&
        !COMMERCE_CONSTRAINTS.SKU_CONTRIBUTOR_FIELD_TYPES.includes(
          characteristics.fieldType,
        )
      ) {
        characteristics.skuContributor = false;
      }

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
        const optionValues = [];
        if (COMMERCE_CONSTRAINTS.FIELD_TYPES_WITH_VALUES.includes(optionCharacteristics.fieldType)) {
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
          }
        }
        catalogOptions[category].push({ ...option, values: optionValues });
      }
    }
    return catalogOptions;
  }
  
  async createCatalogSpecifications(config, options) {
    const { logger, liferay } = this.ctx;
    const categories = options.categories;
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
            optionCategories[groupData.key] = optionCategory;
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
              } catch (patchErr) {
                logger.warn(
                  `Failed to patch option category link for ${specERC}: ${patchErr.message}`
                );
              }
            }
          }

          catalogSpecifications[category].push(specification);
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
      productOptions,
      allowBackOrder,
    } = productData;

    const payload = {
      active: true,
      catalogId: parseInt(config.catalogId, 10),
      name: toI18n(name),
      description: toI18n(description),
      productType: productType || 'simple',
      externalReferenceCode:
        externalReferenceCode || createERC(ERC_PREFIX.PRODUCT),
      productConfiguration: {
        allowBackOrder: allowBackOrder || false,
      },
    };

    const hasSkuContributors = (productOptions || []).some(
      (opt) => opt.skuContributor
    );

    if (options.generateSkuVariants && hasSkuContributors && skus?.length > 0) {
      // Omit SKUs for products that will have variants.
    } else if (skus && Array.isArray(skus)) {
      payload.skus = skus.slice(0, 1);
    }

    const cleanedPayload = this._cleanProductForLiferay(payload, {
      stripSkuOptions: true,
    });

    const createdProduct = await liferay.createProduct(config, cleanedPayload);
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
      allowBackOrder,
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
      productConfiguration: {
        allowBackOrder: allowBackOrder || false,
      },
    };

    const hasSkuContributors = (productOptions || []).some(
      (opt) => opt.skuContributor
    );

    if (options.generateSkuVariants && hasSkuContributors && skus?.length > 0) {
      // Omit SKUs for products that will have variants.
    } else if (skus && Array.isArray(skus)) {
      payload.skus = skus.slice(0, 1);
    }

    const cleanedPayload = this._cleanProductForLiferay(payload, {
      stripSkuOptions: true,
    });

    const createdProduct = await liferay.createProduct(config, cleanedPayload);
    return createdProduct;
  }

  async updateInventory(config, createdProduct, originalProduct, options) {
    const { logger, liferay } = this.ctx;
    const { warehouses } = options;

    if (!warehouses || warehouses.length === 0) {
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
      } catch (error) {
        logger.error(
          `Failed to update inventory for product ${createdProduct.id} in warehouse ${warehouse.id}`,
          { error: error.message }
        );
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
}

module.exports = ProductGenerator;
