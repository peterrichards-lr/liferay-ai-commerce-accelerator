const { delay } = require('../utils/misc.cjs');
const { sanitizedObject } = require('../utils/normalize.cjs');
const { v4: uuidv4 } = require('uuid');

const { ASSET_TYPE, VIEWABLE_BY } = require('../utils/liferayPermissions.cjs');

class ProductGenerator {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async generateProducts(config, options) {
    const { logger, liferay, mockData, media, cache, batchPolling } = this.ctx;
    logger.trace('=== STARTING PRODUCT GENERATION ===');
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
      correlationId: config.correlationId,
      operation: 'generate-products',
      productCount: options.productCount,
      categories: options.productCategories?.length || 0,
      useBatch: useBatch,
      batchSize: config.batchSize || 1,
    });

    const results = {
      products: [],
      created: 0,
      errors: [],
    };

    try {
      this.validateConfig(config);
      await this.validateOptions(options);

      logger.trace('=== VALIDATED CONFIG ===');
      logger.trace('Selected categories:', options.productCategories);
      logger.trace('Selected languages:', config.selectedLanguages);
      logger.trace('Generate SKU variants:', options.generateSkuVariants);

      logger.info('Configuration validated', {
        correlationId: config.correlationId,
        operation: 'validate-config',
        categories: options.productCategories,
        languages: config.selectedLanguages,
      });

      logger.trace(`Using catalog ID: ${config.catalogId}`);
      logger.trace(`Demo mode: ${options.demoMode ? 'ENABLED' : 'DISABLED'}`);
      logger.trace(`Target Liferay URL: ${config.liferayUrl}`);
      logger.trace(
        `Selected languages: ${(config.selectedLanguages || ['en-US']).join(
          ', '
        )}`
      );

      let catalogOptions = {};
      if (options.generateSkuVariants) {
        catalogOptions = await this.createCatalogOptions(config, options);
      }

      let catalogSpecifications = {};
      if (options.generateSpecifications) {
        catalogSpecifications = await this.createCatalogSpecifications(
          config,
          options
        );
      }

      const productsPerCategory = options.productCount;
      for (const category of options.productCategories) {
        logger.trace(`Generating products for category: ${category}`);

        try {
          let productDataList;
          if (options.demoMode) {
            logger.trace(
              `Demo mode: Generating ${productsPerCategory} mock products`
            );
            productDataList = mockData.generateProductData(
              category,
              productsPerCategory,
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
            logger.trace(
              `Demo: Generated ${productDataList.length} ${category} products`
            );
          } else {
            logger.trace(
              `AI mode: Generating ${productsPerCategory} products using ${config.aiModel}`
            );
            productDataList = await ai.generateProductData(
              category,
              productsPerCategory,
              config,
              config.aiModel,
              config.selectedLanguages || ['en-US']
            );
            logger.trace(
              `AI: Generated ${productDataList.length} ${category} products`
            );
          }

          let productImagesPrepared, productPdfsPrepared;
          if (options.imageMode !== 'none') {
            let productsForImages = [];
            if (options.demoMode && options.imageRatio > 0) {
              productsForImages = media.selectProductsForImages(
                productDataList,
                options.imageRatio
              );
              logger.trace(
                `Selected ${
                  productsForImages.length
                } products for image assignment (${
                  options.imageRatio
                }% ratio) ${options.demoMode ? '(Demo Mode)' : ''}`
              );
            }

            productImagesPrepared = productsForImages.length;

            if (productImagesPrepared > 0) {
              let image;
              if (options.imageMode === 'default') {
                image = await media.getDefaultBase64ImageDataUrl(config);
              } else if (options.imageMode === 'custom') {
                image = options.customImageFile;
              }
              productsForImages.forEach((product) => {
                product.images = [];
                product.images.push(image);
              });
            }
          }

          if (options.pdfMode !== 'none') {
            let productsForPDFs = [];
            if (options.demoMode && options.pdfRatio > 0) {
              productsForPDFs = media.selectProductsForPDFs(
                productDataList,
                options.pdfRatio
              );
              logger.trace(
                `Selected ${
                  productsForPDFs.length
                } products for PDF generation (${options.pdfRatio}% ratio) ${
                  options.demoMode ? '(Demo Mode)' : ''
                }`
              );
            }

            productPdfsPrepared = productsForPDFs.length;
            if (productPdfsPrepared > 0) {
              let pdf;
              if (options.pdfMode === 'default') {
                pdf = await media.getgetDefaultBase64PdfDataUrl(config);
              } else if (options.pdfMode === 'custom') {
                pdf = options.customPdfFile;
              }
              productsForPDFs.forEach((product) => {
                product.attachments = [];
                product.attachments.push(pdf);
              });
            }
          }

          logger.trace(
            `Processing ${
              productDataList.length
            } products for category ${category} using ${
              useBatch ? 'batch' : 'individual'
            } operations...`
          );

          const preparedProducts = productDataList.map((productData) => {
            const liferayProduct = {
              active:
                productData.active !== undefined ? productData.active : true,
              catalogId: parseInt(config.catalogId),
              name: productData.name,
              description: productData.description,
              productType: productData.productType || 'simple',
              externalReferenceCode: productData.externalReferenceCode,
            };

            if (productData.shortDescription) {
              liferayProduct.shortDescription = productData.shortDescription;
            }
            if (productData.urls) {
              liferayProduct.urls = productData.urls;
            }
            if (productData.metaDescription) {
              liferayProduct.metaDescription = productData.metaDescription;
            }
            if (productData.metaKeyword) {
              liferayProduct.metaKeyword = productData.metaKeyword;
            }
            if (productData.metaTitle) {
              liferayProduct.metaTitle = productData.metaTitle;
            }

            if (productData.skus && Array.isArray(productData.skus)) {
              liferayProduct.skus = productData.skus;
            } else if (productData.baseSku) {
              const basePrice = Math.floor(Math.random() * 500) + 50;
              liferayProduct.skus = [
                {
                  cost: Math.round(basePrice * 0.6),
                  externalReferenceCode: productData.baseSku,
                  inventoryLevel: Math.floor(Math.random() * 50) + 10,
                  neverExpire: true,
                  price: basePrice,
                  published: true,
                  purchasable: true,
                  sku: productData.baseSku,
                },
              ];
            } else {
              const fallbackSku = `SKU-${Date.now()}-${Math.random()
                .toString(36)
                .substr(2, 5)}`;
              const basePrice = Math.floor(Math.random() * 500) + 50;
              liferayProduct.skus = [
                {
                  cost: Math.round(basePrice * 0.6),
                  externalReferenceCode: fallbackSku,
                  inventoryLevel: Math.floor(Math.random() * 50) + 10,
                  neverExpire: true,
                  price: basePrice,
                  published: true,
                  purchasable: true,
                  sku: fallbackSku,
                },
              ];
            }

            return liferayProduct;
          });

          if (useBatch) {
            logger.trace(
              `Creating ${preparedProducts.length} products using batch endpoint with batch size ${config.batchSize}...`
            );

            const callbackUrl =
              config.microserviceUrl && config.microserviceUrl !== 'null'
                ? `${config.microserviceUrl}/api/batch/callback`
                : null;

            // Remove images and attachments from products for batch creation
            // These will be added separately after the products are created
            const cleanedProducts = preparedProducts.map((product) => {
              const cleanProduct = { ...product };
              // Remove images and attachments to avoid batch processing issues
              delete cleanProduct.images;
              delete cleanProduct.attachments;
              return cleanProduct;
            });

            // Split products into batches based on batchSize
            const productBatches = [];
            for (let i = 0; i < cleanedProducts.length; i += config.batchSize) {
              productBatches.push(
                cleanedProducts.length <= config.batchSize
                  ? cleanedProducts.slice(0, cleanedProducts.length)
                  : cleanedProducts.slice(i, i + config.batchSize)
              );
            }

            logger.trace(
              `Split ${cleanedProducts.length} products into ${productBatches.length} batches of max size ${config.batchSize}`
            );

            const batchIds = [];
            // Process each batch
            for (
              let batchIndex = 0;
              batchIndex < productBatches.length;
              batchIndex++
            ) {
              const batch = productBatches[batchIndex];
              logger.trace(
                `Submitting batch ${batchIndex + 1}/${
                  productBatches.length
                } with ${batch.length} products...`
              );

              const result = await liferay.createProductsBatch(
                config,
                batch,
                callbackUrl
              );

              batchIds.push(result.batchId); // Store batchId

              // Store batch config for polling (if callback URL is provided)
              if (result.batchId && callbackUrl) {
                // Get poll interval from config with validation
                const pollInterval = Math.max(
                  config.pollInterval || 5000,
                  2000
                ); // Minimum 2 seconds
                const maxPollAttempts = config.maxPollAttempts || 120; // Default 10 minutes

                cache.set(
                  `batch:${result.batchId}:config`,
                  {
                    clientId: config.clientId,
                    clientSecret: config.clientSecret,
                    correlationId: config.correlationId,
                    createdAt: new Date().toISOString(),
                    entityType: 'products',
                    liferayUrl: config.liferayUrl,
                    localeCode: config.localeCode,
                    mode: 'generate',
                  },
                  3600000 // 1 hour cache
                );

                logger.info('Batch config stored for polling', {
                  operation: 'batch-config-store',
                  batchId: result.batchId,
                  pollInterval,
                  maxPollAttempts,
                });

                batchPolling.startPolling(
                  result.batchId,
                  {
                    liferayUrl: config.liferayUrl,
                    clientId: config.clientId,
                    clientSecret: config.clientSecret,
                    localeCode: config.localeCode,
                    entityType: 'products',
                  },
                  {
                    pollInterval: config.pollingDelay,
                    maxPollAttempts: config.pollingRetries,
                    onStatusChange: (status) => {
                      logger.debug('Batch status update', {
                        operation: 'batch-status-update',
                        batchId: status.batchId,
                        status: status.status,
                        processedCount: status.processedCount,
                        totalCount: status.totalCount,
                        entityType: 'products',
                      });
                    },
                    onComplete: (results) => {
                      this.handleBatchComplete(results);
                    },
                    onError: (error) => {
                      logger.error('Batch polling error', {
                        operation: 'batch-polling-error',
                        batchId: result.batchId,
                        error: error.message,
                        entityType: 'products',
                      });
                    },
                  }
                );
              }

              logger.info('Batch submission completed', {
                operation: 'create-products-batch',
                batchId: result.batchId,
                productCount: batch.length,
                status: result.status,
                callbackUrl: callbackUrl || 'none',
              });

              results.products.push({
                category: category,
                batchIndex: batchIndex + 1,
                totalBatches: productBatches.length,
                batchId: result.batchId,
                status: result.status,
                productCount: batch.length,
                products: batch.map((p) => ({
                  name: p.name?.en_US || p.name,
                  externalReferenceCode: p.externalReferenceCode,
                })),
              });
              results.created += batch.length;

              // Add delay between batch submissions to avoid overwhelming the server
              if (batchIndex < productBatches.length - 1) {
                await delay(1000);
              }
            }

            // Store the session context for post-processing
            const sessionId = `products_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`;

            // Register the generation session with the global batch polling service
            batchPolling.registerGenerationSession(
              sessionId,
              batchIds,
              batchIds.length
            );

            // Store session data for post-processing
            cache.set(
              `session:${sessionId}:context`,
              {
                config,
                productDataList,
                preparedProducts,
                options,
                sessionId,
              },
              1800000
            ); // 30 minutes cache

            const hasAttachments = productDataList.some(
              (p) => p.images || p.attachments
            );

            logger.info('Session registered for post-processing', {
              operation: 'session-register',
              sessionId,
              totalBatches: batchIds.length,
              hasImages: options.imageMode !== 'none',
              hasPDFs: options.pdfMode !== 'none',
              hasAttachments,
              demoMode: options.demoMode,
            });

            logger.trace(
              `Session ${sessionId} registered - post-processing will trigger after all batches complete`
            );

            // Post-processing will be handled after all batches complete
          } else {
            logger.trace(
              `Creating ${preparedProducts.length} products individually...`
            );

            for (let i = 0; i < preparedProducts.length; i++) {
              const productData = preparedProducts[i];
              const originalProduct = productDataList[i];

              try {
                const createdProduct = await liferay.createProduct(
                  config,
                  productData
                );
                results.products.push(createdProduct);
                results.created++;
                logger.trace(
                  `✓ Created product: ${
                    createdProduct.name?.en_US || createdProduct.name
                  }`
                );

                const productERC = originalProduct.externalReferenceCode;

                let imagesApplied = 0,
                  pdfsApplied = 0;
                if (originalProduct.images) {
                  getWs().emitPostProcessingStarted({ entityType: 'images' });
                  for (const image of originalProduct.images) {
                    if (options.imageMode === 'custom') {
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
                          viewableBy: 'Anyone',
                        }
                      );

                      if (doc) {
                        await liferay.patchPermissionsByAsset(config, {
                          assetType: ASSET_TYPE.DOCUMENT,
                          id: doc.id,
                          viewableBy: VIEWABLE_BY.ANYONE,
                        });
                      }

                      const imageUrlData = {
                        title: { en_US: `Product Image - ${productERC}` },
                        src: `${config.liferayUrl}${doc.contentUrl}`,
                      };

                      await liferay.addProductImageByUrl(
                        config,
                        productERC,
                        imageUrlData
                      );
                    } else {
                      await liferay.addProductImageByBase64(
                        config,
                        createdProduct.externalReferenceCode,
                        image
                      );
                    }
                    logger.trace(
                      `✓ Added image to product: ${createdProduct.externalReferenceCode}`
                    );
                    imagesApplied++;
                    getWs().emitPostProcessingProgress({
                      entityType: 'images',
                      processedCount: imagesApplied,
                      totalCount: productImagesPrepared,
                      progress: Math.round(
                        (imagesApplied / productImagesPrepared) * 100
                      ),
                    });
                  }
                  getWs().emitPostProcessingCompleted({
                    entityType: 'images',
                    processedCount: imagesApplied,
                    totalCount: productImagesPrepared,
                  });
                }

                if (originalProduct.attachments) {
                  getWs().emitPostProcessingStarted({ entityType: 'pdfs' });
                  for (const attachment of originalProduct.attachments) {
                    if (options.pdfMode === 'custom') {
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
                          viewableBy: 'Anyone',
                        }
                      );

                      if (doc) {
                        await liferay.patchPermissionsByAsset(config, {
                          assetType: ASSET_TYPE.DOCUMENT,
                          id: doc.id,
                          viewableBy: VIEWABLE_BY.ANYONE,
                        });
                      }
                      const attachmentUrlData = {
                        title: {
                          en_US: `Product Documentation - ${productERC}`,
                        },
                        src: `${config.liferayUrl}${doc.contentUrl}`,
                      };
                      await liferay.addProductAttachmentByUrl(
                        config,
                        productERC,
                        attachmentUrlData
                      );
                    } else {
                      await liferay.addProductAttachmentByBase64(
                        config,
                        createdProduct.externalReferenceCode,
                        { attachment }
                      );
                    }
                    logger.trace(
                      `✓ Added attachment to product: ${createdProduct.externalReferenceCode}`
                    );
                    pdfsApplied++;
                    getWs().emitPostProcessingProgress({
                      entityType: 'pdfs',
                      processedCount: pdfsApplied,
                      totalCount: productPdfsPrepared,
                      progress: Math.round(
                        (pdfsApplied / productPdfsPrepared) * 100
                      ),
                    });
                  }
                  getWs().emitPostProcessingCompleted({
                    entityType: 'pdfs',
                    processedCount: pdfsApplied,
                    totalCount: productPdfsPrepared,
                  });
                }
              } catch (error) {
                logger.error(
                  `Failed to create product ${
                    productData.name?.en_US || productData.name
                  }:`,
                  error.message
                );
                results.errors.push({
                  category,
                  product: productData.name?.en_US || productData.name,
                  error: error.message,
                });
              }
            }
          }

          // Only generate pricing if price lists option is enabled
          if (options.generatePriceLists && productDataList.length > 0) {
            logger.trace(
              `Generating pricing for ${productDataList.length} products...`
            );
            await this.generateProductPricing(
              config,
              productDataList.map((pd) => ({
                sku: pd.baseSku || pd.externalReferenceCode,
              })), // Pass only necessary info for pricing
              {
                generateBulkPricing: options.generateBulkPricing,
                generateTierPricing: options.generateTierPricing,
              }
            );
          }
        } catch (error) {
          logger.error(
            `Failed to generate products for category ${category}:`,
            error
          );
          results.errors.push({
            category,
            error: error.message,
          });
        }
      }

      logger.trace(
        `Product generation completed: ${results.created} created, ${results.errors.length} errors`
      );
      return results;
    } catch (error) {
      logger.error('Product generation failed', {
        operation: 'generate-products',
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  async createCatalogOptions(config, options) {
    const { logger } = this.ctx;
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

    for (const category of categories) {
      const categoryOptions =
        categoryOptionsMap[category] || categoryOptionsMap['Electronics'];
      catalogOptions[category] = [];
      logger.trace(
        `Processing ${categoryOptions.length} options for category: ${category}`
      );

      for (const optionData of categoryOptions) {
        try {
          logger.trace(
            `Attempting to create option: ${optionData.name} for category ${category}`
          );
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

          let option;
          try {
            logger.trace(
              `Calling liferay.createOption for ${optionData.name}...`
            );
            option = await liferay.createOption(config, {
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
              `✓ Successfully created option: ${option.name.en_US} (ID: ${option.id}, Type: ${optionCharacteristics.fieldType}, SKU: ${optionCharacteristics.skuContributor}, Required: ${optionCharacteristics.required}, Facetable: ${optionCharacteristics.facetable})`
            );
          } catch (createError) {
            if (
              createError.message.includes('409') ||
              createError.message.includes('conflict')
            ) {
              logger.trace(
                `Option ${optionData.name} already exists, fetching existing option...`
              );
              option = await liferay.getOptionByERC(config, optionERC);
              if (!option) {
                logger.warn(
                  `Could not find existing option with ERC: ${optionERC}, skipping...`
                );
                continue;
              }
              logger.trace(
                `Using existing option: ${option.name.en_US} (ID: ${option.id})`
              );
            } else {
              throw createError;
            }
          }

          const optionValues = [];
          for (let i = 0; i < optionData.values.length; i++) {
            const value = optionData.values[i];
            const valueERC = `VAL-${optionERC}-${value
              .toUpperCase()
              .replace(/\s+/g, '_')}`;

            const valueName = {};
            languageCodes.forEach((langCode) => {
              const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
              valueName[langCode] = `${value}${suffix}`;
            });

            try {
              const optionValue = await liferay.createOptionValue(
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
            } catch (valueError) {
              if (
                valueError.message.includes('409') ||
                valueError.message.includes('conflict')
              ) {
                logger.trace(
                  `Option value ${value} already exists for option ${option.id}, fetching existing value...`
                );
                const existingValue = await liferay.getOptionValueByERC(
                  config,
                  option.id,
                  valueERC
                );
                if (existingValue) {
                  optionValues.push(existingValue);
                  logger.trace(
                    `Using existing option value: ${existingValue.name.en_US}`
                  );
                }
              } else {
                logger.warn(
                  `Failed to create option value ${value}: ${valueError.message}`
                );
              }
            }
          }

          logger.trace(
            `Processed ${optionValues.length} values for option: ${option.name.en_US}`
          );

          catalogOptions[category].push({
            ...option,
            values: optionValues,
          });
        } catch (error) {
          logger.error(
            `Failed to process option ${optionData.name} for ${category}:`,
            error
          );
        }
      }
    }

    return catalogOptions;
  }

  async createCatalogSpecifications(config, options) {
    const { logger } = this.ctx;
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
      const categorySpecs =
        categorySpecificationsMap[category] ||
        categorySpecificationsMap['Electronics'];
      const categoryGroups =
        categoryGroupsMap[category] || categoryGroupsMap['Electronics'];
      catalogSpecifications[category] = [];

      const optionCategories = {};
      for (const groupData of categoryGroups) {
        try {
          const categoryERC = `OPTCAT-${category.toUpperCase()}-${groupData.key
            .toUpperCase()
            .replace(/-/g, '_')}`;

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
            if (
              createError.message.includes('409') ||
              createError.message.includes('conflict')
            ) {
              logger.trace(
                `Option category ${groupData.title} already exists, fetching existing category...`
              );
              optionCategory = await liferay.getOptionCategoryByERC(
                config,
                categoryERC
              );
              if (!optionCategory) {
                logger.warn(
                  `Could not find existing option category with ERC: ${categoryERC}, skipping...`
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
          const specERC = `SPEC-${category.toUpperCase()}-${specData.key
            .toUpperCase()
            .replace(/-/g, '_')}`;

          const specTitle = {};
          const specOptionCategory = {};

          languageCodes.forEach((langCode) => {
            const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
            specTitle[langCode] = `${specData.title}${suffix}`;
            specOptionCategory[langCode] = `${category}${suffix}`;
          });

          const linkedOptionCategory = optionCategories[specData.group];

          const specificationPayload = {
            key: specData.key,
            title: specTitle,
            optionCategory: specOptionCategory,
            facetable: true,
            priority: specData.priority,
            externalReferenceCode: specERC,
          };

          if (linkedOptionCategory) {
            specificationPayload.optionCategoryExternalReferenceCode =
              linkedOptionCategory.externalReferenceCode;
            specificationPayload.optionCategoryId = linkedOptionCategory.id;
          }

          let specification;
          try {
            specification = await liferay.createSpecification(
              config,
              specificationPayload
            );
            logger.trace(
              `Created specification: ${specification.title.en_US} (ID: ${specification.id}, Key: ${specData.key}, Group: ${specData.group})`
            );
          } catch (createError) {
            if (
              createError.message.includes('409') ||
              createError.message.includes('conflict')
            ) {
              logger.trace(
                `Specification ${specData.title} already exists, fetching existing specification...`
              );
              specification = await liferay.getSpecificationByERC(
                config,
                specERC
              );
              if (!specification) {
                logger.warn(
                  `Could not find existing specification with ERC: ${specERC}, skipping...`
                );
                continue;
              }
              logger.trace(
                `Using existing specification: ${specification.title.en_US} (ID: ${specification.id})`
              );
            } else {
              throw createError;
            }
          }

          if (linkedOptionCategory) {
            specification.optionCategoryId = linkedOptionCategory.id;
            specification.optionCategoryExternalReferenceCode =
              linkedOptionCategory.externalReferenceCode;
          }

          catalogSpecifications[category].push(specification);
        } catch (error) {
          logger.error(
            `Failed to process specification ${specData.title} for ${category}:`,
            error
          );
        }
      }

      logger.info(
        `Processed ${catalogSpecifications[category].length} specifications for category: ${category}`
      );
    }

    return catalogSpecifications;
  }

  async createBasicProduct(config, productData, options = {}) {
    const { logger } = this.ctx;
    try {
      // Start with minimum required properties as per the example
      const liferayProduct = {
        active: productData.active !== undefined ? productData.active : true,
        catalogId: parseInt(config.catalogId),
        name: productData.name || {
          en_US: productData.name?.en_US || 'Generated Product',
        },
        description: productData.description || {
          en_US: 'AI generated product description',
        },
        productType: productData.productType || 'simple',
        externalReferenceCode:
          productData.externalReferenceCode ||
          `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };

      // Always include these core properties if available
      if (productData.shortDescription) {
        liferayProduct.shortDescription = productData.shortDescription;
      }
      if (productData.urls) {
        liferayProduct.urls = productData.urls;
      }
      if (productData.metaDescription) {
        liferayProduct.metaDescription = productData.metaDescription;
      }
      if (productData.metaKeyword) {
        liferayProduct.metaKeyword = productData.metaKeyword;
      }
      if (productData.metaTitle) {
        liferayProduct.metaTitle = productData.metaTitle;
      }

      // Always include basic SKUs (minimum requirement)
      if (productData.skus && Array.isArray(productData.skus)) {
        liferayProduct.skus = productData.skus;
      }

      // Only add optional properties if the corresponding options are enabled
      if (options.generateSkuVariants && productData.defaultSku) {
        liferayProduct.defaultSku = productData.defaultSku;
      }
      if (
        options.generateSkuVariants &&
        productData.options &&
        Array.isArray(productData.options)
      ) {
        liferayProduct.productOptions = productData.options;
      }
      if (
        options.generateSpecifications &&
        productData.specifications &&
        Array.isArray(productData.specifications)
      ) {
        liferayProduct.productSpecifications = productData.specifications;
      }
      if (
        options.generateSkuVariants &&
        productData.skuVariants &&
        Array.isArray(productData.skuVariants)
      ) {
        liferayProduct.skus = productData.skuVariants;
      }

      logger.info('Creating basic product', {
        operation: 'create-basic-product',
        sku: liferayProduct.sku,
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
        operation: 'create-basic-product',
        productId: createdProduct.id,
        sku: createdProduct.sku,
      });

      return createdProduct;
    } catch (error) {
      logger.error('Failed to create basic product', {
        operation: 'create-basic-product',
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
        operation: 'create-single-product',
        productId: createdProduct.id,
        options: {
          generateSkuVariants: options.generateSkuVariants,
          generateSpecifications: options.generateSpecifications,
          generateAttachments: options.generateAttachments,
        },
      });

      // Only add optional components if the corresponding options are enabled
      if (
        options.generateSkuVariants &&
        options.catalogOptions &&
        options.catalogOptions.length > 0
      ) {
        await this.addProductOptions(
          config,
          createdProduct.id,
          options.catalogOptions
        );
      }

      if (
        options.generateSpecifications &&
        (productData.specifications || options.catalogSpecifications)
      ) {
        await this.addProductSpecifications(
          config,
          createdProduct.id,
          productData.specifications,
          options.catalogSpecifications
        );
      }

      if (options.generateAttachments && productData.attachments) {
        await this.addProductAttachments(
          config,
          createdProduct.id,
          productData.attachments
        );
      }

      if (
        options.generateSkuVariants &&
        options.catalogOptions &&
        options.catalogOptions.length > 0
      ) {
        await this.createProductSkus(
          config,
          createdProduct.id,
          options.catalogOptions,
          productData
        );
      }

      return createdProduct;
    } catch (error) {
      logger.error('Failed to create product with components', {
        operation: 'create-single-product',
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
    const { logger } = this.ctx;
    try {
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
              : {
                  en_US: `Mock ${
                    catalogSpec.title?.en_US || catalogSpec.key
                  } Value`,
                },
          };

          if (catalogSpec.optionCategoryId) {
            specificationPayload.optionCategoryId =
              catalogSpec.optionCategoryId;
          }
          if (catalogSpec.optionCategoryExternalReferenceCode) {
            specificationPayload.optionCategoryExternalReferenceCode =
              catalogSpec.optionCategoryExternalReferenceCode;
          }

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
            specificationsToAdd.push({
              specificationExternalReferenceCode: `SPEC-${
                spec.key || spec.name
              }-${Date.now()}`,
              specificationKey: spec.key || spec.name,
              specificationPriority: spec.priority || 0,
              label: { en_US: spec.name || spec.key },
              value:
                typeof spec.value === 'string'
                  ? { en_US: spec.value }
                  : spec.value,
            });
          }
        }
      }

      if (specificationsToAdd.length > 0) {
        await batchProcessor.processBatch(
          specificationsToAdd,
          async (specData) => {
            return await liferay.addProductSpecification(
              config,
              productId,
              specData
            );
          },
          5
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
    const { logger } = this.ctx;
    try {
      for (const attachment of attachments) {
        const attachmentData = {
          title: attachment.title || { en_US: 'Attachment' },
          priority: attachment.priority || 0,
        };

        // Add contentType if available
        if (attachment.contentType) {
          attachmentData.contentType = attachment.contentType;
        }

        // Handle base64 attachments
        if (attachment.attachment) {
          attachmentData.attachment = attachment.attachment;
        }

        // Handle URL-based attachments
        if (attachment.src && !attachment.attachment) {
          attachmentData.src = attachment.src;
        }

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

      const priceList = await liferay.createPriceList(config, {
        name: {
          en_US: `Generated Price List - ${
            new Date().toISOString().split('T')[0]
          }`,
        },
        currencyCode: config.currencyCode || 'USD',
        priority: 1,
        active: true,
        externalReferenceCode: `PL-${Date.now()}`,
      });

      const pricingData = await ai.generatePricingData(
        products,
        'standard',
        config.aiModel
      );

      for (const product of products) {
        try {
          const basePrice = pricingData.basePrice || Math.random() * 500 + 50;

          const priceEntry = {
            price: basePrice,
            sku: product.sku,
            externalReferenceCode: `PE-${product.sku}-${Date.now()}`,
          };

          await liferay.createPriceEntry(config, priceList.id, priceEntry);

          if (options.generateBulkPricing) {
            await this.generateBulkPricing(
              config,
              priceList.id,
              product,
              basePrice
            );
          }
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
    const { logger } = this.ctx;
    try {
      const specCategories =
        mockSpecCategories ||
        (await this.ai.generateSpecificationCategories(
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
    const { logger } = this.ctx;
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
    const { logger } = this.ctx;
    try {
      const createdSkus = [];
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

          const skuCode = `${productData.baseSku}-${value1.name.en_US
            .substr(0, 2)
            .toUpperCase()}${
            option2 ? `-${value2.name.en_US.substr(0, 2).toUpperCase()}` : ''
          }`;

          const skuOptions = {
            [option1.id]: value1.id,
          };

          if (option2 && value2.id) {
            skuOptions[option2.id] = value2.id;
          }

          const skuData = {
            sku: skuCode,
            published: true,
            purchasable: true,
            cost: Math.round(variantPrice * 0.6),
            price: variantPrice,
            promoPrice: 0,
            externalReferenceCode: `SKU-${skuCode}-${Date.now()}`,
            skuOptions: skuOptions,
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
    const { ai, logger, media } = this.ctx;
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
          fieldValues: [
            {
              name: 'fileEntryId',
              value: pdfResult.objectPath,
            },
          ],
        },
      };

      await liferay.addProductAttachment(config, product.id, attachmentData);
      logger.trace(`✓ PDF successfully attached to product`);
    } catch (error) {
      logger.error('Error generating product PDF:', error);
      throw error;
    }
  }

  async validateOptions(options) {
    const { ai, logger } = this.ctx;
    if (
      !options.productCount ||
      typeof options.productCount !== 'number' ||
      options.productCount <= 0
    ) {
      throw new Error('Product count must be greater than 0');
    }

    if (!options.demoMode) {
      try {
        await ai.getOpenAIClient();
        logger.trace('✓ OpenAI API key validated successfully');
      } catch (error) {
        const errorMessage =
          'OpenAI API key not configured. Please set it in the AI Configuration object or enable demo mode.';
        logger.error('✗ OpenAI key validation failed:', error.message);
        throw new Error(errorMessage);
      }
    }
  }

  validateConfig(config) {
    if (
      !config.catalogId ||
      typeof config.catalogId !== 'number' ||
      config.catalogId <= 0
    ) {
      throw new Error('Catalog ID is required and must be a positive integer.');
    }

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
  }

  async processImageAndPDFAttachments(
    config,
    productDataList,
    preparedProducts,
    options
  ) {
    const { logger, liferay, getWs } = this.ctx;
    logger.info('Starting post-processing for images and PDFs', {
      operation: 'process-attachments',
      productCount: productDataList.length,
      imageMode: options.imageMode,
      pdfMode: options.pdfMode,
    });

    // Count images and PDFs to process
    const imageCount = productDataList.filter((p) => p.images).length;
    const pdfCount = productDataList.filter((p) => p.attachments).length;

    if (imageCount > 0) {
      getWs().emitBatchStarted({
        batchId: 'images-processing',
        entityType: 'images',
        totalItems: imageCount,
      });
    }

    if (pdfCount > 0) {
      getWs().emitBatchStarted({
        batchId: 'pdfs-processing',
        entityType: 'pdfs',
        totalItems: pdfCount,
      });
    }

    let imageProcessedCount = 0;
    let pdfProcessedCount = 0;
    const imageErrors = [];
    const pdfErrors = [];

    for (let i = 0; i < productDataList.length; i++) {
      const originalProduct = productDataList[i];
      const preparedProduct = preparedProducts[i];

      try {
        // Add images
        if (originalProduct.images) {
          for (const image of originalProduct.images) {
            if (options.imageMode === 'custom') {
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
                  documentFolderExternalReferenceCode: options.uploadFolderERC,
                  viewableby: 'Anyone',
                }
              );

              if (doc) {
                await liferay.patchPermissionsByAsset(config, {
                  assetType: ASSET_TYPE.DOCUMENT,
                  id: doc.id,
                  viewableBy: VIEWABLE_BY.ANYONE,
                });
              }

              // choose the right URL field from Liferay's response
              const imageUrlData = {
                title: { en_US: `Product Image - ${productERC}` },
                url: `${config.liferayUrl}${doc.contentUrl}`,
              };

              await liferay.addProductImageByUrl(
                config,
                productERC,
                imageUrlData
              );
            } else {
              await liferay.addProductImageByBase64(
                config,
                preparedProduct.externalReferenceCode,
                image
              );
            }
            logger.trace(
              `✓ Added image to product: ${preparedProduct.externalReferenceCode}`
            );
            imageProcessedCount++;
          }

          // Broadcast image progress
          getWs().emitBatchProgress({
            batchId: 'images-processing',
            entityType: 'images',
            completedCount: imageProcessedCount,
            totalItems: imageCount,
            progress: Math.round((imageProcessedCount / imageCount) * 100),
          });
        }

        // Add PDFs/attachments
        if (originalProduct.attachments) {
          for (const attachment of originalProduct.attachments) {
            if (options.pdfMode === 'custom') {
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
                  documentFolderExternalReferenceCode: options.uploadFolderERC,
                  viewableby: 'Anyone',
                }
              );

              if (doc) {
                await liferay.patchPermissionsByAsset(config, {
                  assetType: ASSET_TYPE.DOCUMENT,
                  id: doc.id,
                  viewableBy: VIEWABLE_BY.ANYONE,
                });
              }

              const attachmentUrlData = {
                title: { en_US: `Product Documentation - ${productERC}` },
                url: `${config.liferayUrl}${doc.contentUrl}`,
              };
              await liferay.addProductAttachmentByUrl(
                config,
                productERC,
                attachmentUrlData
              );
            } else {
              await liferay.addProductAttachmentByBase64(
                config,
                preparedProduct.externalReferenceCode,
                { attachment }
              );
            }
            logger.trace(
              `✓ Added attachment to product: ${preparedProduct.externalReferenceCode}`
            );
            pdfProcessedCount++;
          }

          getWs().emitBatchProgress({
            batchId: 'pdfs-processing',
            entityType: 'pdfs',
            completedCount: pdfProcessedCount,
            totalItems: pdfCount,
            progress: Math.round((pdfProcessedCount / pdfCount) * 100),
          });
        }
      } catch (error) {
        logger.error(
          `Failed to add image/attachment to product ${preparedProduct.externalReferenceCode}:`,
          error.message
        );
        if (originalProduct.image) {
          imageErrors.push({
            product: preparedProduct.externalReferenceCode,
            error: `Image error: ${error.message}`,
          });
        }
        if (originalProduct.attachment) {
          pdfErrors.push({
            product: preparedProduct.externalReferenceCode,
            error: `PDF error: ${error.message}`,
          });
        }
      }
    }

    // Broadcast separate completion messages for images and PDFs
    if (imageCount > 0) {
      getWs().emitBatchCompleted({
        type: 'batch_completed',
        entityType: 'images',
        batchId: 'images-processing',
        successCount: imageProcessedCount,
        failureCount: imageErrors.length,
        errors: imageErrors.slice(0, 5),
      });
    }

    if (pdfCount > 0) {
      getWs().emitBatchCompleted({
        batchId: 'pdfs-processing',
        entityType: 'pdfs',
        successCount: pdfProcessedCount,
        failureCount: pdfErrors.length,
        errors: pdfErrors.slice(0, 5),
      });
    }

    logger.info('Post-processing completed', {
      operation: 'process-attachments-complete',
      imageProcessedCount,
      pdfProcessedCount,
      imageCount,
      pdfCount,
      imageErrorCount: imageErrors.length,
      pdfErrorCount: pdfErrors.length,
    });

    logger.trace(
      `✅ Post-processing completed: Images ${imageProcessedCount}/${imageCount}, PDFs ${pdfProcessedCount}/${pdfCount}, Total errors: ${
        imageErrors.length + pdfErrors.length
      }`
    );
  }

  async handleBatchComplete(results) {
    const { logger } = this.ctx;
    logger.info('Handling batch completion', {
      operation: 'batch-complete-handler',
      batchId: results.batchId,
      status: results.status,
      processedCount: results.processedCount,
      totalCount: results.totalCount,
    });

    // Process batch results and determine success/failure counts
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
      // If content is not an array, assume all were successful if status is COMPLETED
      successCount = results.processedCount || results.totalCount || 0;
    }

    // Send WebSocket update
    getWs().emitBatchCompleted({
      batchId: results.batchId,
      entityType: 'products',
      successCount,
      failureCount,
      errors: failureCount > 0 ? { failures } : null,
    });
  }
}

module.exports = ProductGenerator;
