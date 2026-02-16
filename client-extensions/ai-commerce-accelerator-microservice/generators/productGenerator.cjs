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
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
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
      'product-data-generation': this._runProductDataGenerationStep.bind(this),
      products: this._runProductCreationStep.bind(this),
      'attach-images': this._runAttachImagesStep.bind(this),
      'attach-pdfs': this._runAttachPdfsStep.bind(this),
      'update-inventory': this._runUpdateInventoryStep.bind(this),
    };
  }

  async generate(config, options) {
    const { logger, persistence, batchCallback } = this.ctx;
    const sessionId = options.sessionId || createERC(ERC_PREFIX.BATCH_SESSION);

    const steps = [
      { name: 'generate-warehouses', type: 'sync' },
      { name: 'product-data-generation', type: 'sync' },
      { name: 'products', type: 'sync' },
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

  async _runWarehouseGenerationStep(sessionId, session) {
    const { logger, liferay, warehouseGenerator, cache, persistence } =
      this.ctx;
    const { config, options } = session.context;

    if (!options.createWarehouses) {
      logger.info('Skipping warehouse generation step.', { sessionId });
      return;
    }

    logger.info('Creating warehouses...', { sessionId });
    let warehouses = [];
    if (options.reuseExistingWarehouses) {
      logger.info('Checking for existing warehouses...', { sessionId });
      const existingWarehouses = await liferay.getWarehouses(config);
      warehouses = existingWarehouses || [];
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
      });
      logger.info('Created new warehouses:', { newWarehouses, sessionId });
      warehouses.push(...newWarehouses);
    }

    const updatedOptions = { ...options, warehouses };
    await persistence.updateSessionContext(sessionId, {
      ...session.context,
      options: updatedOptions,
    });

    cache.set('generated-warehouses', warehouses);
    logger.info('Warehouses set in options and cache.', { sessionId });
  }

  async _runProductDataGenerationStep(sessionId, session) {
    const { logger, persistence } = this.ctx;
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
    });

    logger.info('Product data generation step complete', {
      sessionId,
      productCount: allProductData.length,
    });
  }

  async _runProductCreationStep(sessionId, session) {
    const { logger } = this.ctx;
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
      Array.isArray(options.productCategories) &&
      options.productCategories.length
        ? options.productCategories
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
              for (const co of catalogOptions) {
                catalogOptionsMap.set(co.name.en_US, co);
              }
              pd.productOptions = pd.options
                .map((option) => {
                  const catalogOption = catalogOptionsMap.get(option.name);
                  if (catalogOption) {
                    return {
                      optionId: catalogOption.id,
                      optionExternalReferenceCode:
                        catalogOption.externalReferenceCode,
                      facetable: catalogOption.facetable,
                      required: catalogOption.required,
                      skuContributor: catalogOption.skuContributor,
                    };
                  }
                  return null;
                })
                .filter(Boolean);
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
        'No products to create for this session. Marking step as COMPLETED.',
        { sessionId, correlationId }
      );
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH), // Generic ERC for an empty step
        sessionId,
        step_key: 'products',
        status: 'COMPLETED',
      });
      return;
    }

    const useBatch = config.batchSize > 1 && options.productCount > 1;

    if (useBatch) {
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
        if (productData.skus && Array.isArray(productData.skus)) {
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
                status: 'COMPLETED',
            });
        }
        await this.ctx.batchCallback._checkSessionCompletion(sessionId, correlationId);
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
    } else {
      logger.warn(
        'Individual product creation is not yet fully implemented in the new workflow. Skipping product creation.',
        { sessionId }
      );
      await persistence.updateSession(sessionId, { status: 'FAILED' });
    }
  }

  async _runAttachImagesStep(sessionId, session) {
    const { logger, media } = this.ctx;
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
  }

  async _runAttachPdfsStep(sessionId, session) {
    const { logger, media } = this.ctx;
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
  }

  async _runUpdateInventoryStep(sessionId, session) {
    const { logger, liferay } = this.ctx;
    const { config, options, productDataList } = session.context;

    logger.info('Starting update inventory step', { sessionId });

    if (options.createWarehouses) {
      try {
        logger.info('Updating inventory for all products', { sessionId });
        const createdProducts = await liferay.getProducts(config);
        const ercToProductMap = new Map();
        for (const product of createdProducts) {
          ercToProductMap.set(product.externalReferenceCode, product);
        }

        for (const originalProduct of productDataList) {
          const createdProduct = ercToProductMap.get(
            originalProduct.externalReferenceCode
          );
          if (createdProduct) {
            await this.updateInventory(
              config,
              createdProduct,
              originalProduct,
              options
            );
          }
        }
      } catch (error) {
        logger.error('Failed to update inventory', {
          sessionId,
          error: error.message,
        });
      }
    } else {
      logger.info('Skipping inventory update.', { sessionId });
    }
  }

  async onSessionComplete({ sessionId, session, correlationId }) {
    const { logger, ws, liferay, persistence, progress } = this.ctx;

    const dbSession = await persistence.getSession(sessionId);

    if (dbSession.status === 'postprocessing_done') {
      logger.warn('Post-processing already handled for session', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
        sessionId,
        correlationId,
      });
      return;
    }

    await persistence.updateSessionStatus(sessionId, 'postprocessing');

    const completed = Array.isArray(session?.completedBatches)
      ? Array.from(session.completedBatches)
      : [];

    logger.info('Generation session complete; triggering post-processing', {
      entityType: 'products',
      operation: 'generate',
      ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
      sessionId,
      completedBatches: completed,
      correlationId,
    });

    progress.sessionCompleted({
      sessionId,
      correlationId,
    });

    const sessionContext = dbSession.context;

    if (!sessionContext) {
      logger.warn('No session context found for post-processing', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
        sessionId,
        correlationId,
      });
      await persistence.updateSessionStatus(sessionId, 'failed');
      return;
    }

    const { config: sessionConfig, productDataList, options } = sessionContext;
    const demoMode = !!options?.demoMode;

    const shouldProcessDemo =
      demoMode &&
      ((options?.imageRatio ?? 0) > 0 || (options?.pdfRatio ?? 0) > 0);

    const shouldProcessNonDemo =
      !demoMode &&
      ((options?.imageMode &&
        options.imageMode !== 'none' &&
        (options?.imageRatio ?? 0) > 0) ||
        (options?.pdfMode &&
          options.pdfMode !== 'none' &&
          (options?.pdfRatio ?? 0) > 0));

    const shouldProcess = shouldProcessDemo || shouldProcessNonDemo;

    if (!shouldProcess) {
      logger.info('No post-processing work required', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
        sessionId,
        correlationId,
        imageMode: options?.imageMode || 'none',
        pdfMode: options?.pdfMode || 'none',
        imageRatio: options?.imageRatio ?? 0,
        pdfRatio: options?.pdfRatio ?? 0,
      });
      await persistence.updateSessionStatus(sessionId, 'completed');
      return;
    }

    try {
      await this.processImageAndPDFAttachments(sessionConfig, productDataList, {
        ...options,
        sessionId,
      });
    } finally {
      await persistence.updateSessionStatus(sessionId, 'completed');

      logger.info('Post-processing complete; session context cleared', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
        sessionId,
        correlationId,
      });

      if (options.createWarehouses) {
        try {
          logger.info('Updating inventory for all products', { sessionId });
          const createdProducts = await liferay.getProducts(sessionConfig);
          const ercToProductMap = new Map();
          for (const product of createdProducts) {
            ercToProductMap.set(product.externalReferenceCode, product);
          }

          for (const originalProduct of productDataList) {
            const createdProduct = ercToProductMap.get(
              originalProduct.externalReferenceCode
            );
            if (createdProduct) {
              await this.updateInventory(
                sessionConfig,
                createdProduct,
                originalProduct,
                options
              );
            }
          }
        } catch (error) {
          logger.error('Failed to update inventory', {
            sessionId,
            error: error.message,
          });
        }
      }
    }
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
    const categories = options.productCategories;
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
        skuContributor: true,
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
        characteristics.skuContributor = false;
        characteristics.facetable = false;
      }
      if (
        name.includes('feature') ||
        name.includes('accessory') ||
        name.includes('addon')
      ) {
        characteristics.fieldType = 'checkbox_multiple';
        characteristics.skuContributor = false;
      }
      if (
        name.includes('weight') ||
        name.includes('quantity') ||
        (name.includes('size') && values.some((v) => /\d/.test(v)))
      ) {
        characteristics.fieldType = 'numeric';
        characteristics.skuContributor = false;
      }
      if (
        name.includes('custom') ||
        name.includes('personalization') ||
        name.includes('engraving')
      ) {
        characteristics.fieldType = 'text';
        characteristics.skuContributor = false;
        characteristics.facetable = false;
      }
      if (
        name.includes('warranty') ||
        name.includes('delivery') ||
        name.includes('expiration')
      ) {
        characteristics.fieldType = 'date';
        characteristics.skuContributor = false;
      }
      if (name.includes('schedule') || name.includes('appointment')) {
        characteristics.fieldType = 'select_date';
        characteristics.skuContributor = false;
        characteristics.facetable = false;
      }
      if (
        name.includes('color') ||
        name.includes('size') ||
        name.includes('material')
      ) {
        characteristics.required = true;
        characteristics.facetable = true;
      }
      return characteristics;
    };
    const categoryOptionsMap = {
      Electronics: [
        { name: 'Color', values: ['Black', 'White', 'Silver', 'Space Gray'] },
        { name: 'Storage', values: ['64GB', '128GB', '256GB', '512GB', '1TB'] },
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
          const valueERC = `VAL-${option.id}-${value
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
              key: `${option.id}-${value
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
    const categories = options.productCategories;
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
                  key: linkedOptionCategory.key,
                  title: linkedOptionCategory.title,
                  externalReferenceCode:
                    linkedOptionCategory.externalReferenceCode,
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

          const specification = await liferay.createSpecificationWithReuse(
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

  async createBasicProduct(config, productData, options = {}) {
    const { logger, liferay } = this.ctx;
    try {
      const ensuredERC =
        productData.externalReferenceCode || createERC(ERC_PREFIX.PRODUCT);

      const liferayProduct = {
        active: productData.active !== undefined ? productData.active : true,
        catalogId: parseInt(config.catalogId, 10),
        name: toI18n(productData.name),
        description: toI18n(
          productData.description || 'AI generated product description'
        ),
        productType: productData.productType || 'simple',
        externalReferenceCode: ensuredERC,
      };
      if (productData.shortDescription)
        liferayProduct.shortDescription = toI18n(productData.shortDescription);
      if (productData.urls) liferayProduct.urls = productData.urls;
      if (productData.metaDescription)
        liferayProduct.metaDescription = toI18n(productData.metaDescription);
      if (productData.metaKeyword)
        liferayProduct.metaKeyword = toI18n(productData.metaKeyword);
      if (productData.metaTitle)
        liferayProduct.metaTitle = toI18n(productData.metaTitle);
      if (productData.skus && Array.isArray(productData.skus))
        liferayProduct.skus = productData.skus;
      if (options.generateSkuVariants && productData.defaultSku)
        liferayProduct.defaultSku = productData.defaultSku;
      if (
        options.generateSkuVariants &&
        productData.options &&
        Array.isArray(productData.options)
      )
        liferayProduct.productOptions = productData.options;
      if (
        options.generateSpecifications &&
        productData.specifications &&
        Array.isArray(productData.specifications)
      )
        liferayProduct.productSpecifications = productData.specifications;
      if (
        options.generateSkuVariants &&
        productData.skuVariants &&
        Array.isArray(productData.skuVariants)
      )
        liferayProduct.skus = productData.skuVariants;
      logger.info('Creating basic product', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: false, phase: 'submit' }),
        sku: Array.isArray(liferayProduct.skus)
          ? liferayProduct.skus[0]?.sku
          : undefined,
        name: liferayProduct.name?.en_US,
        catalogId: liferayProduct.catalogId,
        includeOptions: options.generateSkuVariants,
        includeSpecifications: options.generateSpecifications,
      });
      const createdProduct = await liferay.createProduct(
        config,
        liferayProduct
      );
      logger.info('Basic product created successfully', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: false, phase: 'submit' }),
        productId: createdProduct.id,
        sku: createdProduct.defaultSku || createdProduct.skus?.[0]?.sku,
      });
      return createdProduct;
    } catch (error) {
      logger.error('Failed to create basic product', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: false, phase: 'error' }),
        error: error.message,
        sku: productData.baseSku || productData.sku || 'unknown',
      });
      throw error;
    }
  }

  async updateInventory(config, createdProduct, originalProduct, options) {
    const { logger, liferay } = this.ctx;
    if (!options.warehouses || options.warehouses.length === 0) {
      return;
    }

    logger.trace(`Updating inventory for product ${createdProduct.id}`);

    const skus = createdProduct.skus || [];
    for (const sku of skus) {
      const inventoryLevel = sku.inventoryLevel || 0;
      const inventoryPerWarehouse = Math.floor(
        inventoryLevel / options.warehouses.length
      );

      for (const warehouse of options.warehouses) {
        try {
          if (options.dryRun) {
            logger.info(`DRY RUN: Skipping inventory update for SKU ${sku.sku} in warehouse ${warehouse.name}`);
          } else {
            await liferay.updateProductInventory(config, warehouse.id, sku.sku, {
                quantity: inventoryPerWarehouse,
            });
          }
          logger.trace(
            `Updated inventory for SKU ${sku.sku} in warehouse ${warehouse.name}`
          );
        } catch (error) {
          logger.error(
            `Failed to update inventory for SKU ${sku.sku} in warehouse ${warehouse.name}`,
            error
          );
        }
      }
    }
  }

  async createSingleProduct(config, productData, options) {
    const { logger } = this.ctx;
    try {
      const createdProduct = await this.createBasicProduct(
        config,
        productData,
        options
      );
      logger.info('Adding optional product components', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: false, phase: 'submit' }),
        productId: createdProduct.id,
        options: {
          generateSkuVariants: options.generateSkuVariants,
          generateSpecifications: options.generateSpecifications,
          generateAttachments: options.generateAttachments,
        },
      });
      if (
        options.generateSkuVariants &&
        options.catalogOptions &&
        options.catalogOptions.length > 0
      )
        await this.addProductOptions(
          config,
          createdProduct.id,
          options.catalogOptions
        );
      if (
        options.generateSpecifications &&
        (productData.specifications || options.catalogSpecifications)
      )
        await this.addProductSpecifications(
          config,
          createdProduct.id,
          productData.specifications,
          options.catalogSpecifications
        );
      if (options.generateAttachments && productData.attachments)
        await this.addProductAttachments(
          config,
          createdProduct.id,
          productData.attachments,
          options
        );
      return createdProduct;
    } catch (error) {
      logger.error('Failed to create single product with all components', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: false, phase: 'error' }),
        error: error.message,
        sku: productData.baseSku || productData.sku || 'unknown',
      });
      throw error;
    }
  }
}

module.exports = ProductGenerator;