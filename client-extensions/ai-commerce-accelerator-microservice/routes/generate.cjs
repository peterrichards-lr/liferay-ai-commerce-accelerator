const multer = require('multer');

const {
  toBoolean,
  toNumber,
  parseMaybeJSON,
  buildConfigAndOptions,
  sanitizedObject,
} = require('..//utils/normalize.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const {
  generateDataSchema,
  generateOrdersSchema,
  generateAccountsSchema,
} = require('../utils/schemas.cjs');
const {
  handleDemoProductGeneration,
  handleDemoAccountGeneration,
  handleDemoOrderGeneration,
} = require('../utils/misc.cjs');
const { ASSET_TYPE, VIEWABLE_BY } = require('../utils/liferayPermissions.cjs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file (tune as needed)
});

module.exports = function (
  app,
  liferayService,
  productGenerator,
  accountGenerator,
  orderGenerator,
  logger
) {
  app.post(
    '/api/generate/accounts',
    inputValidationMiddleware(generateAccountsSchema),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);

      try {
        logger.info('Account generation request received', {
          correlationId: config.correlationId,
          operation: 'generate-accounts',
          accountCount: options.accountCount,
          batchSize: config.batchSize,
          pollingDelay: config.pollingDelay,
          demoMode: !!config.demoMode,
        });

        if (config.demoMode) {
          return handleDemoAccountGeneration(
            config,
            options,
            accountGenerator,
            res
          );
        }

        const results = await accountGenerator.generateAccounts(
          config,
          options
        );

        // For batch operations, return different response format
        if (results.batchId) {
          res.json({
            success: true,
            batchId: results.batchId,
            count: results.count,
            status: results.status,
            message: results.message,
            batch: true,
          });
        } else {
          // Individual creation response
          res.json({
            success: true,
            count: results.created,
            errors: results.errors,
            data: results.accounts,
            batch: false,
          });
        }
      } catch (error) {
        logger.errorWithStack(error, {
          correlationId: config.correlationId,
          operation: 'generate-accounts',
        });
        let errorMessage = error.message;
        if (error.message.includes('OpenAI API key not configured')) {
          errorMessage =
            'AI service error: OpenAI API key not configured. Please set it in the AI Configuration object.';
        }

        res.status(500).json({
          success: false,
          error: `Account generation failed: ${errorMessage}`,
          details: error.stack,
        });
      }
    }
  );

  app.post(
    '/api/generate/products',
    // Accept multipart (files optional). If JSON is sent, this is skipped safely.
    upload.fields([{ name: 'customImageFile' }, { name: 'customPDFFile' }]),
    // Normalize multipart string fields → correct types BEFORE validation
    (req, _res, next) => {
      const b = req.body || {};

      // Arrays/objects that arrive as JSON strings
      if (b.categories) b.categories = parseMaybeJSON(b.categories) || [];
      if (b.selectedLanguages)
        b.selectedLanguages = parseMaybeJSON(b.selectedLanguages) || [];
      if (b.productCategories)
        b.productCategories = parseMaybeJSON(b.productCategories) || [];

      // Numbers
      [
        'productCount',
        'imageWidth',
        'imageHeight',
        'imageRatio',
        'pdfRatio',
        'batchSize',
        'pollingDelay',
        'pollingRetries',
        'catalogId',
        'channelId',
        'siteGroupId',
      ].forEach((k) => (b[k] = toNumber(b[k])));

      // Booleans
      [
        'generatePriceLists',
        'generateBulkPricing',
        'generateTierPricing',
        'generateSpecifications',
        'generateSkuVariants',
        'demoMode',
      ].forEach((k) => (b[k] = toBoolean(b[k])));

      next();
    },
    inputValidationMiddleware(generateDataSchema),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);

      try {
        if (!options.productCount) {
          return res.status(400).json({
            success: false,
            error: 'Product count is required',
          });
        }

        if (!options.productCategories) {
          return res.status(400).json({
            success: false,
            error: 'Product categories are required',
          });
        }

        if (!config.batchSize) {
          return res.status(400).json({
            success: false,
            error: 'Batch size is required',
          });
        }

        if (!options.demoMode && !config.aiModel) {
          return res.status(400).json({
            success: false,
            error: 'AI model is required',
          });
        }

        const actualCount =
          options.productCount > 5
            ? Math.max(config.batchSize, 5)
            : options.productCount;

        let folderERC;
        let folder;

        if (options.customImageFile || options.customPdfFile) {
          folderERC = `AICA_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          const folderName = `AI Commerce Accelerator - ${new Date()
            .toISOString()
            .slice(0, 10)} - ${folderERC.slice(-6)}`;

          const response = await liferayService.createSiteDocumentsFolder(
            config,
            config.siteGroupId,
            folderName,
            folderERC
          );

          folder = response.folder;

          if (folder) {
            await liferayService.patchPermissionsByAsset(config, {
              assetType: ASSET_TYPE.DOCUMENT_FOLDER,
              id: folder.id,
              viewableBy: VIEWABLE_BY.ANYONE,
            });
          }

          options.uploadFolderId = folder.id;
          options.uploadFolderERC =
            options.customImageFile || options.customPdfFile ? folderERC : null;
        }

        logger.info('Starting product generation', {
          correlationId: config.correlationId,
          operation: 'generate-products',
          productCount: options.productCount,
          demoMode: options.demoMode,
          categories: options.categories?.length || 0,
          microserviceUrl: options.microserviceUrl,
        });

        if (options.demoMode) {
          return handleDemoProductGeneration(
            config,
            options,
            productGenerator,
            res
          );
        }

        if (options.pdfMode === 'generate' && options.pdfRatio > 0) {
          const expectedPDFs = Math.ceil(
            actualCount * (options.pdfRatio / 100)
          );
          logger.info('PDF generation configured', {
            correlationId: config.correlationId,
            operation: 'generate-products',
            expectedPDFs,
            pdfRatio: options.pdfRatio,
            productCount: actualCount,
          });
        }

        const results = await productGenerator.generateProducts(
          config,
          options
        );

        // Safe calculation of total products created
        let totalProductsCreated = 0;
        if (results.created) {
          totalProductsCreated = results.created;
        } else if (results.products && Array.isArray(results.products)) {
          totalProductsCreated = results.products.reduce(
            (sum, p) => sum + (p.productCount || 0),
            0
          );
        }

        // Emit progress update via WebSocket for PDF generation
        if (pdfMode === 'generate' && results.pdfProgress) {
          getWs().emitGenerationProgress({
            percent: Math.round(
              (results.pdfProgress.current / result.pdfProgresss.total) * 100
            ),
            entityType: 'pdfs',
            batchId: results.batchId,
          });
        }

        // Emit progress update via WebSocket for Image generation
        if (imageMode === 'generate' && results.imageProgress) {
          getWs().emitGenerationProgress({
            percent: Math.round(
              (results.imageProgress.current / results.imageProgress.total) *
                100
            ),
            entityType: 'images',
            batchId: results.batchId,
          });
        }

        logger.success('Product generation completed successfully', {
          correlationId: req.correlationId,
          operation: 'generate-products',
          productsCreated: totalProductsCreated,
          categoriesProcessed: results.products ? results.products.length : 0,
          batchCount: results.products ? results.products.length : 0,
          resultStructure: {
            hasCreated: !!results.created,
            hasProducts: !!results.products,
            isProductsArray: Array.isArray(results.products),
            resultKeys: Object.keys(results),
          },
        });

        console.log(
          `[${new Date().toLocaleTimeString()}] Successfully generated ${totalProductsCreated} products`
        );

        res.json({
          success: true,
          message: 'Products generated successfully',
          count: totalProductsCreated,
          products: results.products || [],
          correlationId: req.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        // Ensure we always have a meaningful error message
        const errorMessage =
          error.message ||
          error.toString() ||
          'Unknown error occurred during product generation';

        // Enhanced error logging with full request/response context
        logger.error('Product generation failed - Enhanced Debug Info', {
          correlationId: req.correlationId,
          operation: 'generate-products',
          error: errorMessage,
          errorName: error.name || 'UnknownError',
          errorStack: error.stack,
          errorType: typeof error,
          errorDetails: error,
          requestDetails: {
            method: req.method,
            url: req.url,
            body: req.body,
            headers: req.headers,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
          },
          sanitizeConfig: sanitizedObject(config),
          sanitizeOptions: sanitizedObject(options),
        });

        console.error('=== PRODUCT GENERATION ERROR DEBUG ===');
        console.error('Error Message:', errorMessage);
        console.error('Error Name:', error.name);
        console.error('Error Type:', typeof error);
        const sanitizedBody = sanitizedObject(req.body);
        console.error('Request Body:', JSON.stringify(sanitizedBody, null, 2));
        console.error('Full Error Object:', JSON.stringify(error, null, 2));
        console.error('Error Stack:', error.stack);
        console.error('=== END ERROR DEBUG ===');

        res.status(500).json({
          success: false,
          error: `Product generation failed: ${errorMessage}`,
          details: error.stack,
        });
      }
    }
  );

  app.post('/api/validate/products', async (req, res) => {
    const { config, options } = buildConfigAndOptions(req);
    try {
      const products = await liferayService.getProducts(config);

      res.json({
        available: products.length > 0,
        count: products.length,
        required: options.requiredCount || 1,
        sufficient: products.length >= (options.requiredCount || 1),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: config.correlationId,
        operation: 'validate-products',
      });
      res.json({
        available: false,
        count: 0,
        required: options.requiredCount || 1,
        sufficient: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/validate/accounts', async (req, res) => {
    const { config, options } = buildConfigAndOptions(req);
    try {
      const accounts = await liferayService.getAccounts(config);

      res.json({
        available: accounts.length > 0,
        count: accounts.length,
        required: options.requiredCount || 1,
        sufficient: accounts.length >= (options.requiredCount || 1),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: config.correlationId,
        operation: 'validate-accounts',
      });
      res.json({
        available: false,
        count: 0,
        required: options.equiredCount || 1,
        sufficient: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post(
    '/api/generate/orders',
    inputValidationMiddleware(generateOrdersSchema),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);
      try {
        if (options.demoMode) {
          return handleDemoOrderGeneration(
            config,
            options,
            orderGenerator,
            res
          );
        }

        if (!config.channelId) {
          return res.status(400).json({
            success: false,
            error: 'channelId is required for order generation',
          });
        }

        if (!config.currencyCode) {
          return res.status(400).json({
            success: false,
            error: 'currencyCode is required for order generation',
          });
        }

        if (!config.aiModel) {
          return res.status(400).json({
            success: false,
            error: 'AI model is required',
          });
        }

        if (!config.batchSize) {
          return res.status(400).json({
            success: false,
            error: 'Batch size is required',
          });
        }

        const productValidation = await liferayService.validateProducts({
          liferayUrl: config.liferayUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          catalogId: config.catalogId,
          requiredCount: 1,
        });

        if (!productValidation.sufficient) {
          throw new Error(
            `Not enough products available in catalog ${catalogId}. Required: ${productValidation.required}, Available: ${productValidation.count}. Please ensure products are created.`
          );
        }

        const accountValidation = await liferayService.validateAccounts({
          liferayUrl: config.liferayUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          requiredCount: 1,
        });

        if (!accountValidation.sufficient) {
          throw new Error(
            `Not enough accounts available. Required: ${accountValidation.required}, Available: ${accountValidation.count}. Please ensure accounts are created.`
          );
        }

        console.log(`Starting order generation: ${options.orderCount} orders`);

        const results = await orderGenerator.generateOrders(config, options);

        res.json({
          success: true,
          count: results.created,
          errors: results.errors,
          data: results.orders,
        });
      } catch (error) {
        logger.errorWithStack(error, {
          correlationId: config.correlationId,
          operation: 'generate-orders',
        });

        // Check for validation errors that should be warnings
        const errorMessage = error.message || 'Order generation failed';
        let statusCode = 500;

        if (
          errorMessage.includes('No products available') ||
          errorMessage.includes('No accounts available') ||
          errorMessage.includes('Not enough products available') ||
          errorMessage.includes('Not enough accounts available')
        ) {
          statusCode = 400;
        }

        if (errorMessage.includes('OpenAI API key not configured')) {
          errorMessage =
            'AI service error: OpenAI API key not configured. Please set it in the AI Configuration object.';
        }

        res.status(statusCode).json({
          success: false,
          error: `Order generation failed: ${errorMessage}`,
          details: error.stack,
        });
      }
    }
  );
};
