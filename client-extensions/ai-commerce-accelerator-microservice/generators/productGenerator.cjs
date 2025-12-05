const { ASSET_TYPE, VIEWABLE_BY } = require('../utils/liferayPermissions.cjs');
const specificationCatalog = require('../data/specifications.json');
const {
  delay,
  resolvePhaseAndMode,
  createERC,
  toI18n,
  buildOptionCategoryERC,
  buildSpecificationERC,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { sanitizedObject } = require('../utils/normalize.cjs');
const { v4: uuidv4 } = require('uuid');
const {
  getBatchCacheTTLms,
  getEphemeralTTLms,
  getSessionTTLms,
} = require('../utils/ttl.cjs');

const RETRY = { maxAttempts: 3, baseMs: 500, factor: 2 };

class ProductGenerator {
  constructor(ctx) {
    this.ctx = ctx;
    this.handleBatchComplete = this.handleBatchComplete.bind(this);
    this.processImageAndPDFAttachments =
      this.processImageAndPDFAttachments.bind(this);
    this.createOnSessionComplete = this.createOnSessionComplete.bind(this);
  }

  async linkPriceListContext(config, priceList) {
    const { logger, liferay } = this.ctx;
    try {
      if (config.channelId || config.channelERC) {
        try {
          await liferay.assignPriceListToChannel(config, {
            priceListId: priceList.id,
            channelId: config.channelId,
            channelERC: config.channelERC,
          });
          logger.trace(
            `✓ Linked price list ${priceList.id} to channel ${
              config.channelId || config.channelERC
            }`
          );
        } catch (e) {
          logger.warn(`Failed linking price list to channel: ${e.message}`);
        }
      }

      if (
        Array.isArray(config.accountGroupIds) ||
        Array.isArray(config.accountGroupERCs)
      ) {
        const ids = config.accountGroupIds || [];
        const ercs = config.accountGroupERCs || [];
        for (const agId of ids) {
          try {
            await liferay.assignPriceListToAccountGroup(config, {
              priceListId: priceList.id,
              accountGroupId: agId,
            });
            logger.trace(
              `✓ Linked price list ${priceList.id} to account group ${agId}`
            );
          } catch (e) {
            logger.warn(
              `Failed linking price list to account group ${agId}: ${e.message}`
            );
          }
        }
        for (const agERC of ercs) {
          try {
            await liferay.assignPriceListToAccountGroup(config, {
              priceListId: priceList.id,
              accountGroupERC: agERC,
            });
            logger.trace(
              `✓ Linked price list ${priceList.id} to account group (ERC) ${agERC}`
            );
          } catch (e) {
            logger.warn(
              `Failed linking price list to account group ERC ${agERC}: ${e.message}`
            );
          }
        }
      }
    } catch (err) {
      logger.warn(`Price list context linking skipped: ${err.message}`);
    }
  }

  createOnSessionComplete() {
    const { logger, cache, getWs, configService } = this.ctx;
    const markOnce = (sessionId) => {
      const onceKey = `session:${sessionId}:postproc:done`;
      if (cache.get(onceKey)) return false;
      cache.set(onceKey, true, getEphemeralTTLms(configService));
      return true;
    };
    return async ({ sessionId, session, correlationId }) => {
      if (!markOnce(sessionId)) {
        logger.warn('Post-processing already handled for session', {
          entityType: 'products',
          operation: 'generate',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
          sessionId,
          correlationId,
        });
        return;
      }

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

      getWs().emitGenerationSessionComplete(
        {
          entityType: 'products',
          operation: 'generate',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
          sessionId,
          completedBatches: completed,
          timestamp: new Date().toISOString(),
        },
        { correlationId }
      );

      const ctxKey = `session:${sessionId}:context`;
      const sessionContext = cache.get(ctxKey);

      if (!sessionContext) {
        logger.warn('No session context found for post-processing', {
          entityType: 'products',
          operation: 'generate',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
          sessionId,
          correlationId,
        });
        return;
      }

      const { config, productDataList, options } = sessionContext;
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
        return;
      }

      try {
        await this.processImageAndPDFAttachments(config, productDataList, {
          ...options,
          sessionId,
        });
      } finally {
        cache.delete(ctxKey);
        logger.info('Post-processing complete; session context cleared', {
          entityType: 'products',
          operation: 'generate',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
          sessionId,
          correlationId,
        });
      }
    };
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

  async generateProducts(config, options) {
    const {
      logger,
      liferay,
      mockData,
      media,
      cache,
      batchPolling,
      getWs,
      ai,
      configService,
    } = this.ctx;

    const randomSeed = options.randomSeed;
    let prngState = Number.isFinite(randomSeed) ? randomSeed >>> 0 : 0;

    const prng = Number.isFinite(randomSeed)
      ? () => {
          prngState ^= prngState << 13;
          prngState >>>= 0;
          prngState ^= prngState >> 17;
          prngState >>>= 0;
          prngState ^= prngState << 5;
          prngState >>>= 0;
          return (prngState >>> 0) / 0xffffffff;
        }
      : Math.random;

    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

    logger.trace('=== STARTING PRODUCT GENERATION ===');
    logger.trace('Session ID:', sessionId);
    logger.trace('Demo mode:', !!options.demoMode);
    logger.trace('Config:', sanitizedObject(config));
    logger.trace('Generation Options:', sanitizedObject(options));
    const useBatch = config.batchSize > 1 && options.productCount > 1;
    logger.trace(
      `Using ${useBatch ? 'batch' : 'individual'} operations (batch size: ${
        config.batchSize || 1
      })`
    );
    logger.info('Starting product generation', {
      entityType: 'products',
      operation: 'generate',
      ...resolvePhaseAndMode({ useBatch, phase: 'init' }),
      correlationId: config.correlationId,
      totalProducts: options.productCount,
      categories: options.productCategories?.length || 0,
      batchSize: config.batchSize || 1,
    });
    const results = { products: [], created: 0, errors: [] };
    try {
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
        ...resolvePhaseAndMode({ useBatch, phase: 'prepare' }),
        categoryCounts,
        total: options.productCount,
        distributionMode,
      });
      logger.trace(`Using catalog ID: ${config.catalogId}`);
      logger.trace(`Demo mode: ${options.demoMode ? 'ENABLED' : 'DISABLED'}`);
      logger.trace(`Target Liferay URL: ${config.liferayUrl}`);
      logger.trace(
        `Selected languages: ${(config.selectedLanguages || ['en-US']).join(
          ', '
        )}`
      );
      let catalogOptionsByCategory = {};
      if (options.generateSkuVariants)
        catalogOptionsByCategory = await this.createCatalogOptions(config, {
          ...options,
          sessionId,
        });
      let catalogSpecificationsByCategory = {};
      if (options.generateSpecifications)
        catalogSpecificationsByCategory =
          await this.createCatalogSpecifications(config, {
            ...options,
            sessionId,
          });
      const allProductData = [];
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
            }
          }
          allProductData.push(...productDataList);
        } catch (error) {
          logger.error(
            `Failed to generate products for category ${category}:`,
            error
          );
          results.errors.push({ category, error: error.message });
        }
      }
      if (allProductData.length === 0) {
        logger.info('No products generated after distribution', {
          entityType: 'products',
          operation: 'generate',
          ...resolvePhaseAndMode({ useBatch, phase: 'prepare' }),
        });
        return results;
      }
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
        if (productData.shortDescription)
          liferayProduct.shortDescription = toI18n(
            productData.shortDescription
          );
        if (productData.urls) liferayProduct.urls = productData.urls;
        if (productData.metaDescription)
          liferayProduct.metaDescription = toI18n(productData.metaDescription);
        if (productData.metaKeyword)
          liferayProduct.metaKeyword = toI18n(productData.metaKeyword);
        if (productData.metaTitle)
          liferayProduct.metaTitle = toI18n(productData.metaTitle);
        if (
          options.generateSkuVariants &&
          productData.options &&
          Array.isArray(productData.options)
        ) {
          const catalogOptions =
            catalogOptionsByCategory[productData.category] || [];
          const catalogOptionsMap = new Map();
          for (const co of catalogOptions) {
            catalogOptionsMap.set(co.name.en_US, co);
          }
          liferayProduct.productOptions = productData.options
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
        if (
          options.generateSkuVariants &&
          productData.skuVariants &&
          Array.isArray(productData.skuVariants)
        ) {
          liferayProduct.skus = productData.skuVariants;
        }

        if (productData.skus && Array.isArray(productData.skus)) {
          liferayProduct.skus = productData.skus;
        } else if (productData.baseSku) {
          const basePrice = Math.floor(prng() * 500) + 50;
          liferayProduct.skus = [
            {
              cost: Math.round(basePrice * 0.6),
              externalReferenceCode: productData.baseSku,
              inventoryLevel: Math.floor(prng() * 50) + 10,
              neverExpire: true,
              price: basePrice,
              published: true,
              purchasable: true,
              sku: productData.baseSku,
            },
          ];
        } else {
          const fallbackSku = `SKU-${Date.now()}-${prng()
            .toString(36)
            .slice(2, 7)}`;
          const basePrice = Math.floor(prng() * 500) + 50;
          liferayProduct.skus = [
            {
              cost: Math.round(basePrice * 0.6),
              externalReferenceCode: fallbackSku,
              inventoryLevel: Math.floor(prng() * 50) + 10,
              neverExpire: true,
              price: basePrice,
              published: true,
              purchasable: true,
              sku: fallbackSku,
            },
          ];
        }

        if (options.generateSpecifications) {
          const catSpecs = Array.isArray(productData.__catalogSpecifications)
            ? productData.__catalogSpecifications
            : [];
          const provided = Array.isArray(productData.specifications)
            ? productData.specifications
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
            liferayProduct.productSpecifications = productSpecifications;
          }
        }
        return liferayProduct;
      });
      try {
        const ercList = allProductData
          .map((p) => p && p.externalReferenceCode)
          .filter(Boolean);
        cache.set(
          `session:${sessionId}:ercs`,
          ercList,
          getSessionTTLms(configService)
        );
        logger.debug('Persisted ERC list for post-processing', {
          sessionId,
          ercCount: ercList.length,
          sample: ercList.slice(0, 3),
        });
      } catch (e) {
        logger.warn('Failed to persist ERC list for session', {
          sessionId,
          error: e.message,
        });
      }
      let productImagesPrepared = 0;
      let productPdfsPrepared = 0;
      if (
        options?.imageMode &&
        options.imageMode !== 'none' &&
        (options.imageRatio || 0) > 0
      ) {
        const productsForImages = media.selectProductsForImages(
          allProductData,
          options.imageRatio
        );
        productImagesPrepared = productsForImages.length;
        if (productImagesPrepared > 0) {
          if (options.imageMode === 'generate') {
            productsForImages.forEach((product) => {
              product.generateAIImage = true;
            });
          } else {
            let image;
            if (options.imageMode === 'default')
              image = await media.getDefaultBase64ImageDataUrl(config);
            else if (options.imageMode === 'custom') {
              if (!options.customImageFile) {
                logger.warn(
                  'imageMode=custom but no customImageFile provided — skipping image assignment'
                );
              } else {
                image = options.customImageFile;
              }
            }
            productsForImages.forEach((product) => {
              if (image) {
                product.images = [image];
              }
            });
          }
          logger.trace(
            `Selected ${productImagesPrepared} products (global) for image assignment (${options.imageRatio}% ratio)`
          );
        }
      }
      if (
        options?.pdfMode &&
        options.pdfMode !== 'none' &&
        (options.pdfRatio || 0) > 0
      ) {
        const productsForPDFs = media.selectProductsForPDFs(
          allProductData,
          options.pdfRatio
        );
        productPdfsPrepared = productsForPDFs.length;
        if (productPdfsPrepared > 0) {
          if (options.pdfMode === 'generate') {
            productsForPDFs.forEach((product) => {
              product.generateAIPdf = true;
            });
          } else {
            let pdf;
            if (options.pdfMode === 'default')
              pdf = await media.getDefaultBase64PdfDataUrl(config);
            else if (options.pdfMode === 'custom') {
              if (!options.customPdfFile) {
                logger.warn(
                  'pdfMode=custom but no customPdfFile provided — skipping PDF assignment'
                );
              } else {
                pdf = options.customPdfFile;
              }
            }
            productsForPDFs.forEach((product) => {
              if (pdf) {
                product.attachments = [pdf];
              }
            });
          }
        }
        logger.trace(
          `Selected ${productPdfsPrepared} products (global) for PDF generation (${options.pdfRatio}% ratio)`
        );
      }

      if (useBatch) {
        logger.trace(
          `Creating ${preparedProducts.length} products using batch endpoint with batch size ${config.batchSize}...`
        );
        logger.debug(
          `[products] Preparing batch submission: total=${preparedProducts.length}, batchSize=${config.batchSize}`
        );
        const callbackUrl =
          config.microserviceUrl && config.microserviceUrl !== 'null'
            ? `${config.microserviceUrl}/api/batch/callback`
            : null;
        const cleanedProducts = preparedProducts.map((product) => {
          const cleanProduct = { ...product };
          delete cleanProduct.images;
          delete cleanProduct.attachments;
          return cleanProduct;
        });
        const productBatches = [];
        const safeBatchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
        for (let i = 0; i < cleanedProducts.length; i += safeBatchSize)
          productBatches.push(cleanedProducts.slice(i, i + safeBatchSize));
        logger.trace(
          `Split ${cleanedProducts.length} products into ${productBatches.length} batches of max size ${safeBatchSize}`
        );
        const batchIds = [];
        for (
          let batchIndex = 0;
          batchIndex < productBatches.length;
          batchIndex++
        ) {
          const batch = productBatches[batchIndex];
          const batchERC = createERC(ERC_PREFIX.PRODUCT_BATCH);
          logger.trace(
            `Submitting product batch [${batchERC}] ${batchIndex + 1}/${
              productBatches.length
            } with ${batch.length} products...`
          );
          const cbUrl = callbackUrl
            ? `${callbackUrl}?sessionId=${encodeURIComponent(
                sessionId
              )}&batchERC=${encodeURIComponent(batchERC)}`
            : null;
          const result = await (async () => {
            const maxAttempts = 3;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                return await liferay.createProductsBatch(config, batch, cbUrl, {
                  ...options,
                  sessionId,
                });
              } catch (e) {
                const retryable = /(?:429|5\d{2})/.test(
                  String(e?.message || '')
                );
                if (!retryable || attempt === maxAttempts) throw e;
                const wait = RETRY.baseMs * Math.pow(RETRY.factor, attempt - 1);
                logger.warn(`Batch submit retry ${attempt} after ${wait}ms`, {
                  batchIndex,
                  size: batch.length,
                  batchERC,
                  sessionId,
                });
                await delay(wait);
              }
            }
          })();
          const bid = result?.batchId != null ? String(result.batchId) : '';
          if (!bid) {
            logger.error('Batch API did not return a batchId', {
              entityType: 'products',
              operation: 'generate',
              ...resolvePhaseAndMode({ useBatch: true, phase: 'submit' }),
              batchIndex,
              productCount: batch.length,
              status: result?.status,
            });
            results.errors.push({
              batchIndex,
              error: 'Missing batchId from createProductsBatch response',
            });
            continue;
          }
          const startedAt = Date.now();
          cache.set(
            `batch:${bid}:meta`,
            { startedAt, totalCount: batch.length, batchERC, sessionId },
            getBatchCacheTTLms(configService)
          );
          logger.debug('BATCH_START EMIT', {
            batchId: bid,
            entityType: 'products',
            operation: 'generate',
          });
          getWs().emitBatchStarted(
            {
              entityType: 'products',
              operation: 'generate',
              ...resolvePhaseAndMode({ useBatch: true, phase: 'submit' }),
              batchId: bid,
              batchERC,
              totalItems: batch.length,
              sessionId,
            },
            { correlationId: config.correlationId }
          );
          batchIds.push(bid);
          if (bid) {
            const pollInterval = Math.max(config.pollingDelay || 5000, 5000);
            const maxPollAttempts = config.pollingRetries || 120;
            const progressCacheKey = `batch:${bid}:lastProgressPct`;
            cache.set(progressCacheKey, -5, getBatchCacheTTLms(configService));
            cache.set(
              `batch:${bid}:config`,
              {
                correlationId: config.correlationId,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                createdAt: new Date().toISOString(),
                entityType: 'products',
                liferayUrl: config.liferayUrl,
                localeCode: config.localeCode,
                operation: 'generate',
                mode: 'generate',
                affectsProgress: true,
                sessionId,
                batchERC,
              },
              getBatchCacheTTLms(configService)
            );
            logger.info('Batch config stored for polling', {
              entityType: 'products',
              operation: 'generate',
              ...resolvePhaseAndMode({ useBatch: true, phase: 'poll' }),
              batchId: bid,
              pollInterval,
              maxPollAttempts,
            });
            batchPolling.startPolling(
              bid,
              {
                liferayUrl: config.liferayUrl,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                localeCode: config.localeCode,
                entityType: 'products',
              },
              {
                pollInterval,
                maxPollAttempts,
                timeoutMs: maxPollAttempts * pollInterval * 1.5,
                onTimeout: () => {
                  const meta = cache.get(`batch:${bid}:meta`) || {};
                  logger.error(`Polling timed out for batch ${bid}`);
                  getWs().emitBatchCompleted(
                    {
                      entityType: 'products',
                      operation: 'generate',
                      ...resolvePhaseAndMode({
                        useBatch: true,
                        phase: 'timeout',
                      }),
                      batchId: bid,
                      batchERC: meta.batchERC,
                      sessionId: meta.sessionId,
                      successCount: 0,
                      failureCount: 1,
                      errors: [
                        {
                          message: `Polling timed out before completion. Try increasing pollingRetries (${config.pollingRetries}) or pollingDelay (${config.pollingDelay}ms).`,
                        },
                      ],
                    },
                    { correlationId: config.correlationId }
                  );
                },
                onStatusChange: (status) => {
                  const meta = cache.get(`batch:${bid}:meta`) || {};
                  const processed = status.processedCount || 0;
                  const total = Math.max(
                    0,
                    Number(status.totalCount || meta.totalCount || 0)
                  );
                  const elapsedMs = Math.max(
                    1,
                    Date.now() - (meta.startedAt || Date.now())
                  );
                  const rate = processed / (elapsedMs / 1000);
                  const remaining = Math.max(0, total - processed);
                  const etaSeconds =
                    rate > 0 ? Math.round(remaining / rate) : null;
                  const sid = String(status.batchId || bid);
                  if (total > 0) {
                    const pct = total
                      ? Math.max(
                          0,
                          Math.min(100, Math.round((processed / total) * 100))
                        )
                      : 0;
                    const lastPct = cache.get(progressCacheKey) ?? -5;
                    if (pct - lastPct >= 5 || pct === 100) {
                      cache.set(
                        progressCacheKey,
                        pct,
                        getBatchCacheTTLms(configService)
                      );
                      getWs().emitBatchProgress(
                        {
                          entityType: 'products',
                          operation: 'generate',
                          ...resolvePhaseAndMode({
                            useBatch: true,
                            phase: 'poll',
                          }),
                          batchId: sid,
                          batchERC: meta.batchERC,
                          sessionId: meta.sessionId,
                          completedCount: processed,
                          totalItems: total,
                          progress: total
                            ? Math.max(
                                0,
                                Math.min(
                                  100,
                                  Math.round((processed / total) * 100)
                                )
                              )
                            : 0,
                          etaSeconds,
                        },
                        { correlationId: config.correlationId }
                      );
                    }
                  }
                  logger.debug('Batch status update', {
                    entityType: 'products',
                    operation: 'generate',
                    ...resolvePhaseAndMode({ useBatch: true, phase: 'poll' }),
                    batchId: status.batchId,
                    status: status.status,
                    processedCount: status.processedCount,
                    totalCount: status.totalCount,
                  });
                },
                onComplete: (r) => this.handleBatchComplete(r, config),
                onError: (error) => {
                  if (cache.get(`batch:${bid}:completed`)) {
                    logger.warn('Polling error after completion ignored', {
                      entityType: 'products',
                      operation: 'generate',
                      ...resolvePhaseAndMode({
                        useBatch: true,
                        phase: 'poll',
                      }),
                      batchId: bid,
                      error: error.message,
                    });
                    return;
                  }
                  logger.error('Batch polling error', {
                    entityType: 'products',
                    operation: 'generate',
                    ...resolvePhaseAndMode({ useBatch: true, phase: 'poll' }),
                    batchId: bid,
                    error: error.message,
                  });
                  getWs().emitBatchCompleted(
                    {
                      entityType: 'products',
                      operation: 'generate',
                      ...resolvePhaseAndMode({
                        useBatch: true,
                        phase: 'complete',
                      }),
                      batchId: bid,
                      successCount: 0,
                      failureCount: 1,
                      errors: [{ message: error.message }],
                    },
                    { correlationId: config.correlationId }
                  );
                },
                entityType: 'products',
                operation: 'generate',
                mode: 'batch',
                affectsProgress: true,
              }
            );
          }
          logger.info('Batch submission completed', {
            entityType: 'products',
            operation: 'generate',
            ...resolvePhaseAndMode({ useBatch: true, phase: 'submit' }),
            batchId: bid,
            productCount: batch.length,
            status: result.status,
            callbackUrl: callbackUrl || 'none',
          });
          results.products.push({
            batchIndex: batchIndex + 1,
            totalBatches: productBatches.length,
            batchId: bid,
            batchERC,
            status: result.status,
            productCount: batch.length,
            products: batch.map((p) => ({
              name: p.name?.en_US || p.name,
              externalReferenceCode: p.externalReferenceCode,
            })),
          });
          results.created += batch.length;
          if (batchIndex < productBatches.length - 1) await delay(1000);
        }
        const contextCacheKey = `session:${sessionId}:context`;
        cache.set(
          contextCacheKey,
          {
            correlationId: config.correlationId,
            config,
            productDataList: allProductData,
            options,
            sessionId,
          },
          getSessionTTLms(configService)
        );
        batchPolling.registerSession(sessionId, {
          batchIds,
          totalExpected: batchIds.length,
          contextKey: contextCacheKey,
          onSessionComplete: this.createOnSessionComplete(),
        });
        logger.debug(
          `[session ${sessionId}] Registered for post-proc: batches=${
            batchIds.length
          }, hasImages=${
            options?.imageMode && options.imageMode !== 'none'
          }, hasPDFs=${options?.pdfMode && options.pdfMode !== 'none'}`
        );
        const hasAttachments = allProductData.some(
          (p) =>
            (Array.isArray(p.images) && p.images.length > 0) ||
            (Array.isArray(p.attachments) && p.attachments.length > 0)
        );
        logger.info('Session registered for post-processing', {
          entityType: 'products',
          operation: 'generate',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
          sessionId,
          totalBatches: batchIds.length,
          hasImages: !!(
            options?.imageMode &&
            options.imageMode !== 'none' &&
            (options?.imageRatio ?? 0) > 0
          ),
          hasPDFs: !!(
            options?.pdfMode &&
            options.pdfMode !== 'none' &&
            (options?.pdfRatio ?? 0) > 0
          ),
          hasAttachments,
          demoMode: options.demoMode,
          imageRatio: options.imageRatio ?? 0,
          pdfRatio: options.pdfRatio ?? 0,
        });
      } else {
        logger.trace(
          `Creating ${preparedProducts.length} products individually...`
        );


        const batchERC = createERC(ERC_PREFIX.PRODUCT_BATCH);
        const indivBatchId = `products-individual-${Date.now()}`;
        getWs().emitBatchStarted(
          {
            entityType: 'products',
            operation: 'generate',
            ...resolvePhaseAndMode({ useBatch: false, phase: 'submit' }),
            batchId: indivBatchId,
            batchERC,
            totalItems: preparedProducts.length,
            sessionId,
          },
          { correlationId: config.correlationId }
        );
        logger.debug('Using persisted ERC list for individual-mode post-proc', {
          sessionId,
          ercCacheKey: `session:${sessionId}:ercs`,
        });
        let processed = 0;
        for (let i = 0; i < preparedProducts.length; i++) {
          const productData = preparedProducts[i];
          const originalProduct = allProductData[i];
          try {
            const createdProduct = await liferay.createProduct(
              config,
              productData
            );
            results.products.push(createdProduct);
            results.created++;
            processed++;
            getWs().emitBatchProgress(
              {
                entityType: 'products',
                operation: 'generate',
                ...resolvePhaseAndMode({ useBatch: false, phase: 'submit' }),
                batchId: indivBatchId,
                batchERC,
                sessionId,
                completedCount: processed,
                totalItems: preparedProducts.length,
                progress: Math.round(
                  (processed / preparedProducts.length) * 100
                ),
              },
              { correlationId: config.correlationId }
            );

            if (options.generateSpecifications) {
              try {
                await this.addProductSpecifications(
                  config,
                  createdProduct.id,
                  originalProduct.specifications,
                  originalProduct.__catalogSpecifications
                );
              } catch (specErr) {
                logger.warn(
                  `Failed to add specifications for product ${createdProduct.id}: ${specErr.message}`
                );
              }
            }
            const productERC = originalProduct.externalReferenceCode;
            let imagesApplied = 0;
            let pdfsApplied = 0;
            if (originalProduct.images) {
              const imgBatchId = `images-${productERC}`;
              getWs().emitPostProcessingStarted(
                {
                  entityType: 'images',
                  batchId: imgBatchId,
                  batchERC,
                  operation: 'process-images',
                  ...resolvePhaseAndMode({
                    useBatch: false,
                    phase: 'postprocess',
                  }),
                  sessionId,
                },
                { correlationId: config.correlationId }
              );
              for (const image of originalProduct.images) {
                if (options.imageMode === 'custom') {
                  const imgERC = `IMG_${productERC}_${prng()
                    .toString(36)
                    .slice(2, 8)}`;
                  const doc = await liferay.uploadSiteDocumentMultipart(
                    config,
                    image,
                    {
                      title: `Product Image - ${productERC}`,
                      externalReferenceCode: imgERC,
                      documentFolderId: options.uploadFolderId,
                      documentFolderExternalReferenceCode:
                        options.uploadFolderERC,
                      viewableBy: VIEWABLE_BY.ANYONE,
                    }
                  );
                  if (doc) {
                    await liferay.patchPermissionsByAsset(config, {
                      assetType: ASSET_TYPE.DOCUMENT,
                      id: doc.id,
                      viewableBy: VIEWABLE_BY.ANYONE,
                    });
                  }
                  const baseUrl = config.liferayUrl.endsWith('/')
                    ? config.liferayUrl
                    : `${config.liferayUrl}/`;
                  const srcUrl = new URL(doc.contentUrl, baseUrl).toString();
                  const imageUrlData = {
                    title: { en_US: `Product Image - ${productERC}` },
                    src: srcUrl,
                  };
                  await liferay.addProductImageByUrl(
                    config,
                    productERC,
                    imageUrlData
                  );
                } else {
                  await liferay.addProductImageByBase64(
                    config,
                    productERC,
                    image
                  );
                }
                logger.trace(`✓ Added image to product: ${productERC}`);
                imagesApplied++;
              }
              getWs().emitPostProcessingCompleted(
                {
                  entityType: 'images',
                  batchId: imgBatchId,
                  batchERC,
                  operation: 'process-images',
                  ...resolvePhaseAndMode({
                    useBatch: false,
                    phase: 'postprocess',
                  }),
                  processedCount: imagesApplied,
                  totalCount: (originalProduct.images || []).length,
                  sessionId,
                },
                { correlationId: config.correlationId }
              );
            }
            if (originalProduct.attachments) {
              const pdfBatchId = `pdf-${productERC}`;
              getWs().emitPostProcessingStarted(
                {
                  entityType: 'pdfs',
                  batchId: pdfBatchId,
                  batchERC,
                  operation: 'process-attachments',
                  ...resolvePhaseAndMode({
                    useBatch: false,
                    phase: 'postprocess',
                  }),
                  sessionId,
                },
                { correlationId: config.correlationId }
              );
              for (const attachment of originalProduct.attachments) {
                if (options.pdfMode === 'custom') {
                  const pdfERC = `PDF_${productERC}_${prng()
                    .toString(36)
                    .slice(2, 8)}`;
                  const doc = await liferay.uploadSiteDocumentMultipart(
                    config,
                    attachment,
                    {
                      title: `Product Documentation - ${productERC}`,
                      externalReferenceCode: pdfERC,
                      documentFolderId: options.uploadFolderId,
                      documentFolderExternalReferenceCode:
                        options.uploadFolderERC,
                      viewableBy: VIEWABLE_BY.ANYONE,
                    }
                  );
                  if (doc) {
                    await liferay.patchPermissionsByAsset(config, {
                      assetType: ASSET_TYPE.DOCUMENT,
                      id: doc.id,
                      viewableBy: VIEWABLE_BY.ANYONE,
                    });
                  }
                  const baseUrl = config.liferayUrl.endsWith('/')
                    ? config.liferayUrl
                    : `${config.liferayUrl}/`;
                  const srcUrl = new URL(doc.contentUrl, baseUrl).toString();
                  const attachmentUrlData = {
                    title: { en_US: `Product Documentation - ${productERC}` },
                    src: srcUrl,
                  };
                  await liferay.addProductAttachmentByUrl(
                    config,
                    productERC,
                    attachmentUrlData
                  );
                } else {
                  await liferay.addProductAttachmentByBase64(
                    config,
                    productERC,
                    { attachment }
                  );
                }
                logger.trace(`✓ Added attachment to product: ${productERC}`);
                pdfsApplied++;
              }
              getWs().emitPostProcessingCompleted(
                {
                  entityType: 'pdfs',
                  batchId: pdfBatchId,
                  batchERC,
                  operation: 'process-attachments',
                  ...resolvePhaseAndMode({
                    useBatch: false,
                    phase: 'postprocess',
                  }),
                  processedCount: pdfsApplied,
                  totalCount: (originalProduct.attachments || []).length,
                  sessionId,
                },
                { correlationId: config.correlationId }
              );
            }
          } catch (error) {
            logger.error(
              `Failed to create product ${
                productData.name?.en_US || productData.name
              }:`,
              error.message
            );
            results.errors.push({
              product: productData.name?.en_US || productData.name,
              error: error.message,
            });
          }
        }
        getWs().emitBatchCompleted(
          {
            entityType: 'products',
            operation: 'generate',
            ...resolvePhaseAndMode({ useBatch: false, phase: 'complete' }),
            batchId: indivBatchId,
            batchERC,
            sessionId,
            successCount: processed,
            failureCount: results.errors.length,
            errors: results.errors.slice(0, 5),
          },
          { correlationId: config.correlationId }
        );
      }
      if (options.generatePriceLists && allProductData.length > 0) {
        logger.trace(
          `Generating pricing for ${allProductData.length} products (global pass)...`
        );
        await this.generateProductPricing(
          config,
          allProductData.map((pd) => ({
            sku:
              (Array.isArray(pd.skus) && pd.skus[0]?.sku) ||
              pd.baseSku ||
              pd.externalReferenceCode,
          })),
          {
            generateBulkPricing: options.generateBulkPricing,
            generateTierPricing: options.generateTierPricing,
          }
        );
      }
      logger.trace(
        `Product generation completed: ${results.created} created, ${results.errors.length} errors`
      );
      return results;
    } catch (error) {
      const { getWs } = this.ctx;
      logger.error('Product generation failed', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch, phase: 'error' }),
        error: error.message,
        stack: error.stack,
      });
      try {
        const failKey = `products:${
          useBatch ? 'batch' : 'indiv'
        }:failed:emitted:${config.correlationId || 'global'}`;
        if (!cache.get(failKey)) {
          cache.set(
            failKey,
            true,
            useBatch
              ? getBatchCacheTTLms(configService)
              : getEphemeralTTLms(configService)
          );
          getWs().emitBatchCompleted(
            {
              entityType: 'products',
              operation: 'generate',
              ...resolvePhaseAndMode({ useBatch, phase: 'error' }),
              batchId: 'products-failed',
              successCount: 0,
              failureCount: 1,
              errors: [{ message: error.message }],
            },
            { correlationId: config.correlationId }
          );
        }
      } catch {}
      throw error;
    }
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
        const optionValues = [];
        for (let i = 0; i < optionData.values.length; i++) {
          const values = Array.isArray(optionData.values)
            ? optionData.values
            : [];
          const value = values[i];
          const valueERC = `VAL-${optionERC}-${value
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
              key: `${category.toLowerCase()}-${value
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

    const categorySpecificationsMap = {
      Electronics: [
        {
          key: 'screen-size',
          title: 'Screen Size',
          priority: 1,
          group: 'physical',
        },
        {
          key: 'battery-life',
          title: 'Battery Life',
          priority: 2,
          group: 'performance',
        },
        {
          key: 'processor',
          title: 'Processor',
          priority: 3,
          group: 'performance',
        },
        { key: 'ram', title: 'RAM', priority: 4, group: 'performance' },
        {
          key: 'storage-capacity',
          title: 'Storage Capacity',
          priority: 5,
          group: 'performance',
        },
        {
          key: 'operating-system',
          title: 'Operating System',
          priority: 6,
          group: 'performance',
        },
        {
          key: 'connectivity',
          title: 'Connectivity',
          priority: 7,
          group: 'connectivity',
        },
        {
          key: 'camera-resolution',
          title: 'Camera Resolution',
          priority: 8,
          group: 'connectivity',
        },
        { key: 'warranty', title: 'Warranty', priority: 9, group: 'support' },
        { key: 'weight', title: 'Weight', priority: 10, group: 'physical' },
      ],
      Clothing: [
        {
          key: 'material',
          title: 'Material',
          priority: 1,
          group: 'material-care',
        },
        {
          key: 'care-instructions',
          title: 'Care Instructions',
          priority: 2,
          group: 'material-care',
        },
        { key: 'fit-type', title: 'Fit Type', priority: 3, group: 'fit-style' },
        { key: 'season', title: 'Season', priority: 4, group: 'fit-style' },
        { key: 'brand', title: 'Brand', priority: 5, group: 'origin' },
        {
          key: 'country-of-origin',
          title: 'Country of Origin',
          priority: 6,
          group: 'origin',
        },
        {
          key: 'closure-type',
          title: 'Closure Type',
          priority: 7,
          group: 'details',
        },
        {
          key: 'sleeve-length',
          title: 'Sleeve Length',
          priority: 8,
          group: 'details',
        },
        { key: 'pattern', title: 'Pattern', priority: 9, group: 'details' },
        {
          key: 'collar-type',
          title: 'Collar Type',
          priority: 10,
          group: 'details',
        },
      ],
      'Home & Garden': [
        {
          key: 'dimensions',
          title: 'Dimensions',
          priority: 1,
          group: 'dimensions-weight',
        },
        {
          key: 'weight',
          title: 'Weight',
          priority: 2,
          group: 'dimensions-weight',
        },
        {
          key: 'material',
          title: 'Material',
          priority: 3,
          group: 'material-build',
        },
        {
          key: 'weather-resistance',
          title: 'Weather Resistance',
          priority: 4,
          group: 'features',
        },
        {
          key: 'assembly-required',
          title: 'Assembly Required',
          priority: 5,
          group: 'material-build',
        },
        {
          key: 'maintenance',
          title: 'Maintenance',
          priority: 6,
          group: 'care-warranty',
        },
        { key: 'capacity', title: 'Capacity', priority: 7, group: 'features' },
        {
          key: 'power-source',
          title: 'Power Source',
          priority: 8,
          group: 'features',
        },
        {
          key: 'warranty',
          title: 'Warranty',
          priority: 9,
          group: 'care-warranty',
        },
        {
          key: 'safety-features',
          title: 'Safety Features',
          priority: 10,
          group: 'features',
        },
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

          let optionCategory;
          try {
            optionCategory = await liferay.createOptionCategory(config, {
              key: `${category.toLowerCase()}-${groupData.key}`,
              title: categoryTitle,
              description: categoryDescription,
              priority: groupData.priority,
              externalReferenceCode: categoryERC,
            });
            logger.trace(
              `Created option category: ${optionCategory.title.en_US} (ID: ${optionCategory.id}, Key: ${groupData.key})`
            );
          } catch (createError) {
            const isConflict =
              createError?.status === 409 ||
              createError?.problem?.status === 'CONFLICT' ||
              String(createError?.message || '')
                .toLowerCase()
                .includes('409') ||
              String(createError?.message || '')
                .toLowerCase()
                .includes('conflict');

            if (isConflict) {
              optionCategory = await liferay.getOptionCategoryByERC(
                config,
                categoryERC
              );
              if (!optionCategory && liferay.getOptionCategoryByKey) {
                optionCategory = await liferay.getOptionCategoryByKey(
                  config,
                  `${category.toLowerCase()}-${groupData.key}`
                );
              }
              if (!optionCategory) {
                logger.warn(
                  `Conflict creating option category but could not resolve by ERC or key: ${categoryERC}`
                );
                continue;
              }
              logger.trace(
                `Using existing option category: ${optionCategory.title.en_US} (ID: ${optionCategory.id})`
              );
            } else {
              throw createError;
            }
          }

          optionCategories[groupData.key] = optionCategory;
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
                    optionCategory: { id: desiredId },
                  });
                } else if (desiredERC) {
                  await liferay.updateSpecificationByERC(config, specERC, {
                    optionCategory: { externalReferenceCode: desiredERC },
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
            error
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
          productData.attachments
        );
      if (
        options.generateSkuVariants &&
        options.catalogOptions &&
        options.catalogOptions.length > 0
      )
        await this.createProductSkus(
          config,
          createdProduct.id,
          options.catalogOptions,
          productData
        );
      return createdProduct;
    } catch (error) {
      logger.error('Failed to create product with components', {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: false, phase: 'error' }),
        error: error.message,
        sku: productData.baseSku || productData.sku || 'unknown',
      });
      throw error;
    }
  }

  async addProductSpecifications(
    config,
    productId,
    productSpecifications,
    catalogSpecifications
  ) {
    const { logger, liferay, batchProcessor, getWs } = this.ctx;
    try {
      const pickFromJson = (category, specKey) => {
        try {
          const defs = specificationCatalog?.[category];
          if (!defs) return null;
          const values = defs[specKey];
          if (!Array.isArray(values) || values.length === 0) return null;
          const choice = values[Math.floor(Math.random() * values.length)];
          return typeof choice === 'string' ? { en_US: choice } : choice;
        } catch {
          return null;
        }
      };
      const specificationsToAdd = [];
      if (catalogSpecifications && catalogSpecifications.length > 0) {
        for (const catalogSpec of catalogSpecifications) {
          const productSpec = productSpecifications?.find(
            (ps) =>
              ps.key === catalogSpec.key || ps.name === catalogSpec.title?.en_US
          );
          const specificationPayload = {
            specificationExternalReferenceCode:
              catalogSpec.externalReferenceCode,
            specificationKey: catalogSpec.key,
            specificationPriority: catalogSpec.priority || 0,
            label: catalogSpec.title,
            value: productSpec?.value
              ? typeof productSpec.value === 'string'
                ? { en_US: productSpec.value }
                : productSpec.value
              : pickFromJson(
                  productSpec?.category ||
                    catalogSpec?.category ||
                    'Electronics',
                  catalogSpec.key
                ) || {
                  en_US: `Mock ${
                    catalogSpec.title?.en_US || catalogSpec.key
                  } Value`,
                },
          };
          if (catalogSpec.optionCategoryId)
            specificationPayload.optionCategoryId =
              catalogSpec.optionCategoryId;
          if (catalogSpec.optionCategoryExternalReferenceCode)
            specificationPayload.optionCategoryExternalReferenceCode =
              catalogSpec.optionCategoryExternalReferenceCode;
          specificationsToAdd.push(specificationPayload);
        }
      }
      if (productSpecifications) {
        for (const spec of productSpecifications) {
          const alreadyAdded = specificationsToAdd.some(
            (s) =>
              s.specificationKey === spec.key ||
              s.specificationKey === spec.name
          );
          if (!alreadyAdded) {
            const payload = {
              specificationExternalReferenceCode: `SPEC-${
                spec.key || spec.name
              }-${Date.now()}`,
              specificationKey: spec.key || spec.name,
              specificationPriority: spec.priority || 0,
              label: { en_US: spec.name || spec.key },
              value:
                typeof spec.value === 'string'
                  ? { en_US: spec.value }
                  : spec.value ||
                    pickFromJson(
                      spec.category || 'Electronics',
                      spec.key || spec.name
                    ) || { en_US: 'Unknown' },
            };

            specificationsToAdd.push(payload);
          }
        }
      }
      if (specificationsToAdd.length > 0) {
        await batchProcessor.processBatchWithProgress(
          specificationsToAdd,
          async (specData) =>
            liferay.addProductSpecification(config, productId, specData),
          5,
          (progress) => {
            getWs().emitBatchProgress(
              {
                batchId: 'product-specs',
                entityType: 'products',
                completedCount: progress.processed,
                totalItems: progress.total,
                progress: progress.percentage,
                operation: 'process-specs',
                meta: progress.meta,
              },
              { correlationId: config.correlationId }
            );
          },
          {
            operation: 'process-specs',
            broadcastMeta: { batchId: 'product-specs', entityType: 'products' },
          }
        );
        logger.trace(
          `Added ${specificationsToAdd.length} specifications to product ${productId}`
        );
      }
    } catch (error) {
      logger.error(
        `Failed to add specifications to product ${productId}:`,
        error
      );
    }
  }

  async addProductAttachments(config, productId, attachments) {
    const { logger, liferay } = this.ctx;
    try {
      for (const attachment of attachments) {
        const attachmentData = {
          title: attachment.title || { en_US: 'Attachment' },
          priority: attachment.priority || 0,
        };
        if (attachment.contentType)
          attachmentData.contentType = attachment.contentType;
        if (attachment.attachment)
          attachmentData.attachment = attachment.attachment;
        if (attachment.src && !attachment.attachment)
          attachmentData.src = attachment.src;
        await liferay.addProductAttachment(config, productId, attachmentData);
      }
      logger.trace(
        `Added ${attachments.length} attachments to product ${productId}`
      );
    } catch (error) {
      logger.error(`Failed to add attachments to product ${productId}:`, error);
    }
  }

  async generateProductPricing(config, products, options) {
    const { logger, ai, liferay } = this.ctx;
    try {
      logger.trace(`Generating pricing for ${products.length} products`);
      const currency = (config.currencyCode || 'USD').toUpperCase();
      const priceList = await liferay.createPriceList(config, {
        name: {
          en_US: `Generated Price List - ${
            new Date().toISOString().split('T')[0]
          }`,
        },
        currencyCode: currency,
        priority: 1,
        active: true,
        externalReferenceCode: `PL-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
      });
      await this.linkPriceListContext(config, priceList);
      const pricingData = await ai.generatePricingData(
        products,
        'standard',
        config.aiModel
      );
      const asMap = Array.isArray(pricingData)
        ? Object.fromEntries(pricingData.map((p) => [p.sku, p]))
        : typeof pricingData === 'object'
        ? pricingData
        : {};
      for (const product of products) {
        try {
          const candidate = Number(asMap?.[product.sku]?.basePrice);
          const fallback = Math.random() * 500 + 50;
          const raw = Number.isFinite(candidate) ? candidate : fallback;
          const basePrice = Math.max(1, Math.min(raw, 99999));
          const priceEntry = {
            price: basePrice,
            sku: product.sku,
            externalReferenceCode: `PE-${product.sku}-${Date.now()}`,
          };
          await liferay.createPriceEntry(config, priceList.id, priceEntry);
          if (options.generateBulkPricing)
            await this.generateBulkPricing(
              config,
              priceList.id,
              product,
              basePrice
            );
        } catch (error) {
          logger.error(
            `Failed to create price entry for product ${product.sku}:`,
            error
          );
        }
      }
      logger.trace(
        `Created price list ${priceList.id} with entries for ${products.length} products`
      );
    } catch (error) {
      logger.error('Failed to generate product pricing:', error);
    }
  }

  async generateBulkPricing(config, priceListId, product, basePrice) {
    const { logger, liferay } = this.ctx;
    try {
      const bulkTiers = [
        { minQuantity: 10, discountPercent: 5 },
        { minQuantity: 25, discountPercent: 10 },
        { minQuantity: 50, discountPercent: 15 },
        { minQuantity: 100, discountPercent: 20 },
      ];
      for (const tier of bulkTiers) {
        const discountedPrice = basePrice * (1 - tier.discountPercent / 100);
        const tierEntry = {
          price: discountedPrice,
          sku: product.sku,
          minQuantity: tier.minQuantity,
          externalReferenceCode: `BT-${product.sku}-${
            tier.minQuantity
          }-${Date.now()}`,
        };
        await liferay.createPriceEntry(config, priceListId, tierEntry);
      }
      logger.trace(`Created bulk pricing tiers for product ${product.sku}`);
    } catch (error) {
      logger.error(
        `Failed to create bulk pricing for product ${product.sku}:`,
        error
      );
    }
  }

  async createSpecificationCategories(
    categories,
    selectedLanguages = ['en_US'],
    mockSpecCategories = null
  ) {
    const { logger, ai, liferay } = this.ctx;
    try {
      const specCategories =
        mockSpecCategories ||
        (await ai.generateSpecificationCategories(
          categories,
          selectedLanguages
        ));
      for (const category of specCategories) {
        try {
          await liferay.createSpecificationCategory(category);
        } catch (error) {
          logger.error(
            `Failed to create specification category ${category.key}:`,
            error.message
          );
        }
      }
    } catch (error) {
      logger.error('Error creating specification categories:', error);
    }
  }

  async addProductOptions(config, productId, catalogOptions) {
    const { logger, liferay } = this.ctx;
    try {
      const productOptionsToAdd = [];
      for (const catalogOption of catalogOptions.slice(0, 3)) {
        const productOption = {
          optionId: catalogOption.id,
          optionExternalReferenceCode: catalogOption.externalReferenceCode,
          facetable: catalogOption.facetable,
          required: catalogOption.required,
          skuContributor: catalogOption.skuContributor,
        };
        productOptionsToAdd.push(productOption);
      }
      if (productOptionsToAdd.length > 0) {
        await liferay.addProductOptions(config, productId, productOptionsToAdd);
        logger.trace(
          `Added ${productOptionsToAdd.length} options to product ${productId}`
        );
      }
    } catch (error) {
      logger.error(`Failed to add options to product ${productId}:`, error);
    }
  }

  async createProductSkus(config, productId, catalogOptions, productData) {
    const { logger, liferay } = this.ctx;
    try {
      const createdSkus = [];
      if (productData.skuVariants && Array.isArray(productData.skuVariants)) {
        const catalogOptionsMap = new Map();
        for (const co of catalogOptions) {
          catalogOptionsMap.set(co.name.en_US, co);
        }

        for (const skuVariant of productData.skuVariants) {
          const skuOptions = {};
          if (skuVariant.options) {
            for (const [optionName, optionValue] of Object.entries(
              skuVariant.options
            )) {
              const catalogOption = catalogOptionsMap.get(optionName);
              if (catalogOption) {
                const catalogOptionValue = catalogOption.values.find(
                  (v) => v.name.en_US === optionValue
                );
                if (catalogOptionValue) {
                  skuOptions[catalogOption.id] = catalogOptionValue.id;
                }
              }
            }
          }

          const skuData = {
            ...skuVariant,
            externalReferenceCode:
              skuVariant.externalReferenceCode ||
              `SKU-${skuVariant.sku}-${Date.now()}`,
            skuOptions,
          };
          delete skuData.options;

          const createdSku = await liferay.createProductSku(
            config,
            productId,
            skuData
          );
          createdSkus.push(createdSku);
        }
        logger.trace(
          `Created ${createdSkus.length} SKUs for product ${productId} from AI data`
        );
        return createdSkus;
      }

      const maxVariants = 8;
      const option1 = catalogOptions[0];
      const option2 = catalogOptions[1] || null;
      if (!option1) {
        logger.trace('No options available for SKU variants');
        return [];
      }
      const basePrice = Math.floor(Math.random() * 500) + 50;
      let variantCount = 0;
      for (const value1 of option1.values.slice(0, 3)) {
        const option2Values = option2
          ? option2.values.slice(0, 3)
          : [{ id: null, name: { en_US: 'Standard' } }];
        for (const value2 of option2Values) {
          if (variantCount >= maxVariants) break;
          const priceModifier = (Math.random() - 0.5) * 0.4;
          const variantPrice = Math.round(basePrice * (1 + priceModifier));
          const base = productData.baseSku || `SKU-${productId}`;
          const v1 = (value1?.name?.en_US || 'V1').slice(0, 2).toUpperCase();
          const v2 = option2
            ? `-${(value2?.name?.en_US || 'V2').slice(0, 2).toUpperCase()}`
            : '';
          const skuCode = `${base}-${v1}${v2}`
            .normalize('NFKD')
            .replaceAll(/[^\w-]+/g, '')
            .replaceAll(/-+/g, '-')
            .trim();
          const skuOptions = { [option1.id]: value1.id };
          if (option2 && value2.id) skuOptions[option2.id] = value2.id;
          const skuData = {
            sku: skuCode,
            published: true,
            purchasable: true,
            cost: Math.round(variantPrice * 0.6),
            price: variantPrice,
            promoPrice: 0,
            externalReferenceCode: `SKU-${skuCode}-${Date.now()}`,
            skuOptions,
          };
          const createdSku = await liferay.createProductSku(
            config,
            productId,
            skuData
          );
          createdSkus.push(createdSku);
          variantCount++;
        }
        if (variantCount >= maxVariants) break;
      }
      logger.trace(
        `Created ${createdSkus.length} SKUs for product ${productId}`
      );
      return createdSkus;
    } catch (error) {
      logger.error(`Failed to create SKUs for product ${productId}:`, error);
      return [];
    }
  }

  async generateProductPDF(config, product, productData, category) {
    const { ai, logger, media, liferay } = this.ctx;
    try {
      logger.trace(`Generating AI content for PDF...`);
      const pdfContent = await ai.generatePDFContent(
        productData,
        category,
        config.aiModel
      );
      logger.trace(`Creating PDF document...`);
      const pdfResult = await media.generateAndUploadProductPDF(
        pdfContent,
        productData.baseSku || product.sku
      );
      const attachmentData = {
        displayDate: new Date().toISOString(),
        externalReferenceCode: uuidv4(),
        priority: 1,
        title: {
          en_US: `${
            productData.name?.en_US || productData.name
          } - Product Documentation`,
        },
        type: 'other',
        options: {
          fieldValues: [{ name: 'fileEntryId', value: pdfResult.objectPath }],
        },
      };
      await liferay.addProductAttachment(config, product.id, attachmentData);
      logger.trace(`✓ PDF successfully attached to product`);
    } catch (error) {
      logger.error('Error generating product PDF:', error);
      throw error;
    }
  }

  async validateOptions(config, options) {
    const { ai, logger } = this.ctx;
    if (
      !options.productCount ||
      typeof options.productCount !== 'number' ||
      options.productCount <= 0
    )
      throw new Error('Product count must be greater than 0');
    if (
      !Array.isArray(options.productCategories) ||
      options.productCategories.length === 0
    )
      throw new Error('At least one product category must be provided.');
    if (!options.demoMode) {
      if (!config.aiModel) {
        const err = new Error(
          'AI model not configured. Please select an AI model in the AI Configuration object.'
        );
        err.statusCode = 400;
        logger?.error?.(
          '✗ AI model validation failed for products: missing aiModel'
        );
        throw err;
      }

      try {
        await ai.getOpenAIClient(config);
        logger.trace('✓ OpenAI API key validated successfully for products');
      } catch (error) {
        const msg =
          'OpenAI API key not configured. Please set it in the AI Configuration object or enable demo mode.';
        logger.error(
          '✗ OpenAI key validation failed for products:',
          error.message
        );
        throw new Error(msg);
      }
    }
  }

  validateConfig(config) {
    const catalogIdNum = parseInt(config.catalogId, 10);
    if (!Number.isFinite(catalogIdNum) || catalogIdNum <= 0)
      throw new Error('Catalog ID is required and must be a positive integer.');
    const pollingRetriesValue = config.pollingRetries;
    if (pollingRetriesValue === undefined || pollingRetriesValue === null)
      throw new Error('pollingRetries is required');
    const pollingRetries = parseInt(pollingRetriesValue);
    if (isNaN(pollingRetries) || pollingRetries < 0 || pollingRetries > 120)
      throw new Error('pollingRetries must be between 0 and 120');
    const pollingDelayValue = config.pollingDelay;
    if (pollingDelayValue === undefined || pollingDelayValue === null)
      throw new Error('pollingDelay is required');
    const pollingDelay = parseInt(pollingDelayValue);
    if (isNaN(pollingDelay) || pollingDelay < 5000 || pollingDelay > 600000)
      throw new Error('pollingDelay must be between 5 and 600 seconds');
  }

  async processImageAndPDFAttachments(config, productDataList, options) {
    const { logger, liferay, getWs, cache, configService } = this.ctx;
    const sessionId = options.sessionId;

    logger.info('Starting post-processing for images and PDFs', {
      entityType: 'products',
      operation: 'generate',
      ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
      productCount: productDataList.length,
      imageMode: options.imageMode,
      pdfMode: options.pdfMode,
      correlationId: config.correlationId,
    });
    logger.debug(
      `[post-proc] Init: items=${productDataList.length}, imageMode=${options.imageMode}, pdfMode=${options.pdfMode}`
    );

    const imageCount = productDataList.reduce(
      (acc, p) => acc + (Array.isArray(p.images) ? p.images.length : 0),
      0
    );
    const pdfCount = productDataList.reduce(
      (acc, p) =>
        acc + (Array.isArray(p.attachments) ? p.attachments.length : 0),
      0
    );

    const imagesBatchERC =
      imageCount > 0 ? createERC(ERC_PREFIX.PRODUCT_BATCH) : null;
    const pdfsBatchERC =
      pdfCount > 0 ? createERC(ERC_PREFIX.PRODUCT_BATCH) : null;

    if (imageCount > 0) {
      getWs().emitBatchStarted(
        {
          entityType: 'images',
          operation: 'process-images',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
          batchId: 'images-processing',
          batchERC: imagesBatchERC,
          totalItems: imageCount,
          sessionId,
        },
        { correlationId: config.correlationId }
      );
    }

    if (pdfCount > 0) {
      getWs().emitBatchStarted(
        {
          entityType: 'pdfs',
          operation: 'process-attachments',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
          batchId: 'pdfs-processing',
          batchERC: pdfsBatchERC,
          totalItems: pdfCount,
          sessionId,
        },
        { correlationId: config.correlationId }
      );
    }

    let imageProcessedCount = 0;
    let pdfProcessedCount = 0;
    const imageErrors = [];
    const pdfErrors = [];

    const poolSize =
      Number(options.postProcConcurrency) > 0
        ? Math.max(1, Math.min(16, Number(options.postProcConcurrency)))
        : 5;

    let lastImagePct = -5;
    let lastPdfPct = -5;
    const maybeEmitProgress = (type) => {
      if (type === 'images' && imageCount > 0) {
        const pct = Math.round((imageProcessedCount / imageCount) * 100);
        if (pct - lastImagePct >= 5 || pct === 100) {
          lastImagePct = pct;
          getWs().emitBatchProgress(
            {
              entityType: 'images',
              operation: 'process-images',
              ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
              batchId: 'images-processing',
              completedCount: imageProcessedCount,
              totalItems: imageCount,
              progress: pct,
              sessionId,
            },
            { correlationId: config.correlationId }
          );
        }
      }
      if (type === 'pdfs' && pdfCount > 0) {
        const pct = Math.round((pdfProcessedCount / pdfCount) * 100);
        if (pct - lastPdfPct >= 5 || pct === 100) {
          lastPdfPct = pct;
          getWs().emitBatchProgress(
            {
              entityType: 'pdfs',
              operation: 'process-attachments',
              ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
              batchId: 'pdfs-processing',
              completedCount: pdfProcessedCount,
              totalItems: pdfCount,
              progress: pct,
              sessionId,
            },
            { correlationId: config.correlationId }
          );
        }
      }
    };

    const tasks = productDataList.map((originalProduct, index) => {
      return async () => {
        const productERC = originalProduct.externalReferenceCode;

        if (!productERC) {
          logger.warn(
            'Missing ERC on originalProduct; skipping post-proc item',
            {
              entityType: 'products',
              operation: 'generate',
              ...resolvePhaseAndMode({ useBatch: true, phase: 'postprocess' }),
              index,
            }
          );
          return;
        }

        const pImageErrors = [];
        const pPdfErrors = [];

        try {
          if (originalProduct.generateAIImage) {
            await this.generateAndAttachAiImage(
              config,
              originalProduct,
              options
            );
            imageProcessedCount++;
            maybeEmitProgress('images');
          } else if (
            Array.isArray(originalProduct.images) &&
            originalProduct.images.length > 0
          ) {
            for (const image of originalProduct.images) {
              try {
                if (options.imageMode === 'custom') {
                  if (!options.uploadFolderId && !options.uploadFolderERC) {
                    logger.warn(
                      'Custom image upload skipped: no uploadFolderId or uploadFolderERC configured.'
                    );
                    continue;
                  }
                  const imgERC = `IMG_${productERC}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`;
                  const doc = await liferay.uploadSiteDocumentMultipart(
                    config,
                    image,
                    {
                      title: `Product Image - ${productERC}`,
                      externalReferenceCode: imgERC,
                      documentFolderId: options.uploadFolderId,
                      documentFolderExternalReferenceCode:
                        options.uploadFolderERC,
                      viewableBy: VIEWABLE_BY.ANYONE,
                    }
                  );
                  if (!doc || !doc.contentUrl) {
                    throw new Error(
                      'Upload returned no document or contentUrl'
                    );
                  }
                  await liferay.patchPermissionsByAsset(config, {
                    assetType: ASSET_TYPE.DOCUMENT,
                    id: doc.id,
                    viewableBy: VIEWABLE_BY.ANYONE,
                  });
                  const baseUrl = config.liferayUrl.endsWith('/')
                    ? config.liferayUrl
                    : `${config.liferayUrl}/`;
                  const srcUrl = new URL(doc.contentUrl, baseUrl).toString();
                  const imageUrlData = {
                    title: { en_US: `Product Image - ${productERC}` },
                    src: srcUrl,
                  };
                  await liferay.addProductImageByUrl(
                    config,
                    productERC,
                    imageUrlData
                  );
                } else {
                  await liferay.addProductImageByBase64(
                    config,
                    productERC,
                    image
                  );
                }
                if (logger.isTraceEnabled?.()) {
                  logger.trace(`✓ Added image to product: ${productERC}`);
                }
                imageProcessedCount++;
                maybeEmitProgress('images');
              } catch (err) {
                logger.warn(`Image failed for ${productERC}: ${err.message}`);
                const rec = { product: productERC, error: err.message };
                imageErrors.push(rec);
                pImageErrors.push(rec);
              }
            }
          }

          if (originalProduct.generateAIPdf) {
            await this.generateAndAttachAiPdf(config, originalProduct);
            pdfProcessedCount++;
            maybeEmitProgress('pdfs');
          } else if (
            Array.isArray(originalProduct.attachments) &&
            originalProduct.attachments.length > 0
          ) {
            for (const attachment of originalProduct.attachments) {
              try {
                if (options.pdfMode === 'custom') {
                  if (!options.uploadFolderId && !options.uploadFolderERC) {
                    logger.warn(
                      'Custom PDF upload skipped: no uploadFolderId or uploadFolderERC configured.'
                    );
                    continue;
                  }
                  const pdfERC = `PDF_${productERC}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`;
                  const doc = await liferay.uploadSiteDocumentMultipart(
                    config,
                    attachment,
                    {
                      title: `Product Documentation - ${productERC}`,
                      externalReferenceCode: pdfERC,
                      documentFolderId: options.uploadFolderId,
                      documentFolderExternalReferenceCode:
                        options.uploadFolderERC,
                      viewableBy: VIEWABLE_BY.ANYONE,
                    }
                  );
                  if (!doc || !doc.contentUrl) {
                    throw new Error(
                      'Upload returned no document or contentUrl'
                    );
                  }
                  await liferay.patchPermissionsByAsset(config, {
                    assetType: ASSET_TYPE.DOCUMENT,
                    id: doc.id,
                    viewableBy: VIEWABLE_BY.ANYONE,
                  });
                  const baseUrl = config.liferayUrl.endsWith('/')
                    ? config.liferayUrl
                    : `${config.liferayUrl}/`;
                  const srcUrl = new URL(doc.contentUrl, baseUrl).toString();
                  const attachmentUrlData = {
                    title: { en_US: `Product Documentation - ${productERC}` },
                    src: srcUrl,
                  };
                  await liferay.addProductAttachmentByUrl(
                    config,
                    productERC,
                    attachmentUrlData
                  );
                } else {
                  await liferay.addProductAttachmentByBase64(
                    config,
                    productERC,
                    { attachment }
                  );
                }
                if (logger.isTraceEnabled?.()) {
                  logger.trace(`✓ Added attachment to product: ${productERC}`);
                }
                pdfProcessedCount++;
                maybeEmitProgress('pdfs');
              } catch (err) {
                logger.warn(`PDF failed for ${productERC}: ${err.message}`);
                const rec = { product: productERC, error: err.message };
                pdfErrors.push(rec);
                pPdfErrors.push(rec);
              }
            }
          }
        } catch (error) {
          logger.error(
            `Failed to add image/attachment to product ${productERC}:`,
            error.message
          );
          if (
            originalProduct.generateAIImage ||
            (Array.isArray(originalProduct.images) &&
              originalProduct.images.length > 0)
          ) {
            const rec = {
              product: productERC,
              error: `Image error: ${error.message}`,
            };
            imageErrors.push(rec);
            pImageErrors.push(rec);
          }
          if (
            originalProduct.generateAIPdf ||
            (Array.isArray(originalProduct.attachments) &&
              originalProduct.attachments.length > 0)
          ) {
            const rec = {
              product: productERC,
              error: `PDF error: ${error.message}`,
            };
            pdfErrors.push(rec);
            pPdfErrors.push(rec);
          }
        }
      };
    });

    const runPool = async (fns, n) => {
      let idx = 0;
      const workers = Array.from(
        { length: Math.min(n, fns.length) },
        async () => {
          while (true) {
            const current = idx++;
            if (current >= fns.length) break;
            await fns[current]();
          }
        }
      );
      await Promise.allSettled(workers);
    };

    logger.debug(
      `[post-proc] Starting pool: size=${poolSize}, images=${imageCount}, pdfs=${pdfCount}`
    );

    await runPool(tasks, poolSize);

    logger.debug(
      `[post-proc] Pool complete: imagesDone=${imageProcessedCount}/${imageCount}, pdfsDone=${pdfProcessedCount}/${pdfCount}`
    );

    if (imageCount > 0) {
      getWs().emitBatchCompleted(
        {
          entityType: 'images',
          operation: 'process-images',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
          batchId: 'images-processing',
          successCount: imageProcessedCount,
          failureCount: imageErrors.length,
          errors: imageErrors.slice(0, 5),
          sessionId,
        },
        { correlationId: config.correlationId }
      );
    }

    if (pdfCount > 0) {
      getWs().emitBatchCompleted(
        {
          entityType: 'pdfs',
          operation: 'process-attachments',
          ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
          batchId: 'pdfs-processing',
          successCount: pdfProcessedCount,
          failureCount: pdfErrors.length,
          errors: pdfErrors.slice(0, 5),
          sessionId,
        },
        { correlationId: config.correlationId }
      );
    }

    logger.info('Post-processing completed', {
      entityType: 'products',
      operation: 'generate',
      ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
      imageProcessedCount,
      pdfProcessedCount,
      imageCount,
      pdfCount,
      imageErrorCount: imageErrors.length,
      pdfErrorCount: pdfErrors.length,
    });
    logger.debug(
      `[post-proc] Summary: images=${imageProcessedCount}/${imageCount} (errors=${imageErrors.length}), pdfs=${pdfProcessedCount}/${pdfCount} (errors=${pdfErrors.length})`
    );

    logger.trace(
      `✅ Post-processing completed: Images ${imageProcessedCount}/${imageCount}, PDFs ${pdfProcessedCount}/${pdfCount}, Total errors: ${
        imageErrors.length + pdfErrors.length
      }`
    );
  }

  async generateAndAttachAiImage(config, productData, options) {
    const { ai, logger, liferay } = this.ctx;
    const productERC = productData.externalReferenceCode;
    try {
      logger.trace(`Generating AI image for product: ${productERC}`);
      const imageB64 = await ai.generateImageDataForProduct(
        productData,
        options
      );
      await liferay.addProductImageByBase64(config, productERC, imageB64);
      logger.trace(`✓ AI Image successfully attached to product ${productERC}`);
    } catch (error) {
      logger.error(
        `Failed to generate and attach AI image for product ${productERC}:`,
        error
      );
      throw error;
    }
  }

  async generateAndAttachAiPdf(config, productData) {
    const { ai, logger, media, liferay } = this.ctx;
    const productERC = productData.externalReferenceCode;
    try {
      logger.trace(`Generating AI content for PDF for product: ${productERC}`);
      const pdfContent = await ai.generatePDFContent(
        productData,
        productData.category,
        config
      );

      logger.trace(`Creating PDF document for product: ${productERC}`);
      const pdfBuffer = await media.generateProductPDF(
        pdfContent,
        productData.baseSku || productERC,
        config
      );

      await liferay.addProductAttachmentByBase64(config, productERC, {
        attachment: pdfBuffer.toString('base64'),
        contentType: 'application/pdf',
        title: {
          en_US: `${productData.name?.en_US || productData.name} - Document`,
        },
      });

      logger.trace(`✓ AI PDF successfully attached to product ${productERC}`);
    } catch (error) {
      logger.error(
        `Failed to generate and attach AI PDF for product ${productERC}:`,
        error
      );
      throw error;
    }
  }

  async handleBatchComplete(results, config) {
    const { logger, getWs, cache, configService } = this.ctx;

    const bid = String(results.batchId || '');
    cache.set(
      `batch:${bid}:completed`,
      true,
      getBatchCacheTTLms(configService)
    );

    const meta = cache.get(`batch:${bid}:meta`) || {};
    const { batchERC, sessionId } = meta;

    logger.info('Handling batch completion', {
      entityType: 'products',
      operation: 'generate',
      ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
      batchId: bid,
      batchERC,
      sessionId,
      status: results.status,
      processedCount: results.processedCount,
      totalCount: results.totalCount,
    });

    const content = results.content;
    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    if (Array.isArray(content)) {
      content.forEach((item, index) => {
        if (item.status === 'SUCCESS' || item.status === 'CREATED') {
          successCount++;
        } else {
          failureCount++;
          failures.push({
            index,
            error: item.error || item.message || 'Unknown error',
          });
        }
      });
    } else {
      successCount = results.processedCount || results.totalCount || 0;
    }

    getWs().emitBatchCompleted(
      {
        entityType: 'products',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
        batchId: bid,
        batchERC,
        sessionId,
        successCount,
        failureCount,
        errors: failureCount > 0 ? failures.slice(0, 5) : [],
      },
      { correlationId: config.correlationId }
    );
  }
}

module.exports = ProductGenerator;
