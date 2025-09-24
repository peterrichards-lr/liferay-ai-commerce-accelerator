const multer = require('multer');

const {
  toBoolean,
  toNumber,
  parseMaybeJSON,
  bufferToDataUrl,
} = require('..//utils/normalize.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const orderGenerator = require('../services/orderGenerator.cjs');
const {
  generateDataSchema,
  generateOrdersSchema,
} = require('../utils/schemas.cjs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file (tune as needed)
});

module.exports = function (app, liferayService, productGenerator, logger) {
  async function handleDemoProductGeneration(req, res) {
    const {
      liferayUrl,
      clientId,
      clientSecret,
      catalogId,
      count,
      categories,
      generatePDFs,
      pdfRatio,
      selectedLanguages,
      batchSize,
      microserviceUrl,
      pollingDelay,
    } = req.body;

    try {
      console.log(
        `Demo mode: Generating ${count} mock products using batch endpoint`
      );

      const validMicroserviceUrl =
        microserviceUrl &&
        microserviceUrl !== 'undefined' &&
        microserviceUrl !== 'null'
          ? microserviceUrl
          : null;

      const config = {
        liferayUrl,
        clientId,
        clientSecret,
        catalogId,
        microserviceUrl: validMicroserviceUrl,
        demoMode: true,
        selectedLanguages,
        pollingDelay: pollingDelay,
      };

      const options = {
        count: count,
        categories: categories,
        catalogId: config.catalogId,
        generatePDFs,
        pdfRatio: pdfRatio,
        generateImages: req.body.generateImages,
        imageRatio: req.body.imageRatio || 0,
        batchSize: batchSize,
        pollingDelay: pollingDelay,
        demoMode: true,
      };

      // Use the same productGenerator.generateProducts method as live mode
      const result = await productGenerator.generateProducts(config, options);

      // Calculate PDFs
      const expectedPDFs =
        generatePDFs && pdfRatio > 0 ? Math.ceil(count * (pdfRatio / 100)) : 0;

      // Emit progress update via WebSocket for PDF generation
      if (generatePDFs && result.pdfProgress) {
        global.broadcastProgress({
          type: 'generation-progress',
          generator: 'product',
          subType: 'pdf',
          batchId: result.products[0]?.batchId,
          progress: result.pdfProgress.current / result.pdfProgress.total,
          current: result.pdfProgress.current,
          total: result.pdfProgress.total,
          timestamp: new Date().toISOString(),
        });
      }

      // Emit progress update via WebSocket for Image generation
      if (req.body.generateImages && result.imageProgress) {
        global.broadcastProgress({
          type: 'generation-progress',
          generator: 'product',
          subType: 'image',
          batchId: result.products[0]?.batchId,
          progress: result.imageProgress.current / result.imageProgress.total,
          current: result.imageProgress.current,
          total: result.imageProgress.total,
          timestamp: new Date().toISOString(),
        });
      }

      // Fix for undefined products log message
      console.log(
        `Demo: Successfully initiated batch creation of ${
          result.created || 0
        } products`
      );

      res.json({
        success: true,
        batchId: result.products[0]?.batchId,
        count: result.created || 0, // Ensure count is a number
        pdfCount: expectedPDFs,
        errors: result.errors,
        status: result.products[0]?.status || 'submitted',
        demo: true,
        batch: true,
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'demo-generate-products',
      });
      res.status(500).json({
        success: false,
        error: 'Demo product generation failed',
        demo: true,
      });
    }
  }
  async function handleDemoOrderGeneration(req, res) {
    const {
      liferayUrl,
      clientId,
      clientSecret,
      catalogId,
      channelId,
      currencyCode,
      localeCode,
      aiModel,
      selectedLanguages,
      orderCount,
      batchSize,
      microserviceUrl,
      pollingDelay,
    } = req.body;

    try {
      console.log(
        `Demo mode: Generating ${orderCount} mock orders using consistent service approach`
      );

      // Validate catalogId is provided as integer
      if (!catalogId || typeof catalogId !== 'number' || catalogId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'catalogId is required and must be a positive integer',
          demo: true,
        });
      }

      const config = {
        liferayUrl,
        clientId,
        clientSecret,
        catalogId,
        channelId,
        currencyCode,
        localeCode,
        microserviceUrl,
        aiModel: aiModel || 'gpt-4o',
        selectedLanguages,
        demoMode: true,
        pollingDelay: pollingDelay,
      };

      const options = {
        count: orderCount,
        batchSize: batchSize,
        catalogId: config.catalogId,
        enableRetry: req.body.enableRetry,
      };

      // Use the same orderGenerator.generateOrders method as live mode
      const result = await orderGenerator.generateOrders(config, options);

      res.json({
        success: true,
        count: result.created,
        errors: result.errors,
        data: result.orders,
        demo: true,
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'demo-generate-orders',
      });

      // Check for validation errors that should be warnings
      const errorMessage = error.message || 'Demo order generation failed';
      let statusCode = 500;

      if (
        errorMessage.includes('No products available') ||
        errorMessage.includes('No accounts available')
      ) {
        statusCode = 400; // Bad request for validation errors
      }

      res.status(statusCode).json({
        success: false,
        error: errorMessage,
        demo: true,
      });
    }
  }

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

      // Numbers
      [
        'count',
        'imageWidth',
        'imageHeight',
        'imageRatio',
        'pdfRatio',
        'batchSize',
        'pollingDelay',
        'catalogId',
        'channelId',
        'siteGroupId',
      ].forEach((k) => (b[k] = toNumber(b[k])));

      // Booleans
      [
        'generatePriceLists',
        'generateBulkPricing',
        'generateTierPricing',
        'generateImages',
        'generateSpecifications',
        'generateSkuVariants',
        'generatePDFs',
        'demoMode',
        'generateAttachments',
      ].forEach((k) => (b[k] = toBoolean(b[k])));

      next();
    },
    inputValidationMiddleware(generateDataSchema),
    async (req, res) => {
      try {
        const b = req.body || {};

        // Convert uploaded files → data URLs (if present)
        const imgFile = (req.files?.customImageFile || [])[0];
        const pdfFile = (req.files?.customPDFFile || [])[0];

        let customImageDataUrl,
          customPdfDataUrl,
          customImageName,
          customPdfName;

        if (imgFile?.buffer?.length) {
          customImageDataUrl = bufferToDataUrl(
            imgFile.buffer,
            imgFile.mimetype || 'image/jpeg'
          );
          customImageName = imgFile.originalname || 'image';
        }
        if (pdfFile?.buffer?.length) {
          customPdfDataUrl = bufferToDataUrl(
            pdfFile.buffer,
            pdfFile.mimetype || 'application/pdf'
          );
          customPdfName = pdfFile.originalname || 'file.pdf';
        }

        // If the client sometimes sends base64 in JSON, honor it as fallback
        if (!customImageDataUrl && b.customImageBase64) {
          customImageDataUrl = /^data:/.test(b.customImageBase64)
            ? b.customImageBase64
            : `data:image/jpeg;base64,${b.customImageBase64}`;
          customImageName = b.customImageName || customImageName || 'image';
        }
        if (!customPdfDataUrl && b.customPdfBase64) {
          customPdfDataUrl = /^data:/.test(b.customPdfBase64)
            ? b.customPdfBase64
            : `data:application/pdf;base64,${b.customPdfBase64}`;
          customPdfName = b.customPdfName || customPdfName || 'file.pdf';
        }

        // Build the flat payload to your generator/Liferay
        const payload = {
          // connection + i18n
          liferayUrl: b.liferayUrl,
          microserviceUrl: b.microserviceUrl,
          localeCode: b.localeCode,
          languageId: b.languageId,
          pollingDelay: b.pollingDelay,

          // commerce
          catalogId: b.catalogId,
          channelId: b.channelId,
          siteGroupId: b.siteGroupId,
          currencyCode: b.currencyCode,

          // generation config
          aiModel: b.aiModel,
          batchSize: b.batchSize,
          selectedLanguages: b.selectedLanguages || [],
          categories: b.categories || [],
          count: b.count,

          // toggles & params
          generatePriceLists: b.generatePriceLists,
          generateBulkPricing: b.generateBulkPricing,
          generateTierPricing: b.generateTierPricing,
          generateAttachments: b.generateAttachments,
          generateSpecifications: b.generateSpecifications,
          generateSkuVariants: b.generateSkuVariants,
          generateImages: b.generateImages,
          imageWidth: b.imageWidth,
          imageHeight: b.imageHeight,
          imageQuality: b.imageQuality,
          imageStyle: b.imageStyle,
          imageRatio: b.imageRatio,
          generatePDFs: b.generatePDFs,
          pdfRatio: b.pdfRatio,
          demoMode: b.demoMode,

          // credentials (flat)
          clientId: b.clientId,
          clientSecret: b.clientSecret,

          // data URLs (optional)
          customImageDataUrl,
          customImageName,
          customPdfDataUrl,
          customPdfName,
        };

        // Call your internal generator or Liferay here…
        // const out = await liferayService.generateProducts(payload);

        return res.json({
          success: true,
          message: 'Generation request accepted',
        });
      } catch (err) {
        logger.errorWithStack(err, {
          correlationId: req.correlationId,
          operation: 'generate-products',
        });
        return res.status(400).json({ success: false, error: err.message });
      }
    }
  );

  app.post(
    '/api/generate/products',
    inputValidationMiddleware(generateDataSchema),
    async (req, res) => {
      try {
        const {
          liferayUrl,
          clientId,
          clientSecret,
          catalogId,
          channelId,
          currencyCode,
          localeCode,
          aiModel,
          selectedLanguages,
          productCount,
          productCategories,
          generatePriceLists,
          generateBulkPricing,
          generateTierPricing,
          generateAttachments,
          generateSpecifications,
          generatePDFs,
          pdfRatio,
          batchSize,
          demoMode,
          microserviceUrl,
          pollingDelay,
        } = req.body;

        if (!req.body.count && !productCount) {
          return res.status(400).json({
            success: false,
            error: 'Product count is required',
          });
        }

        if (!req.body.categories && !productCategories) {
          return res.status(400).json({
            success: false,
            error: 'Product categories are required',
          });
        }

        if (!batchSize) {
          return res.status(400).json({
            success: false,
            error: 'Batch size is required',
          });
        }

        if (!aiModel) {
          return res.status(400).json({
            success: false,
            error: 'AI model is required',
          });
        }

        const actualCount = req.body.count || productCount;
        const actualBatchSize =
          actualCount > 5 ? Math.max(batchSize, 5) : batchSize;

        // Determine microservice URL - use environment variable or construct from request
        let microserviceUrlFromConfig = microserviceUrl;
        if (
          !microserviceUrlFromConfig ||
          microserviceUrlFromConfig === 'null' ||
          microserviceUrlFromConfig === 'undefined'
        ) {
          // Try to construct from environment or request headers
          const protocol =
            req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
          const host =
            req.headers['x-forwarded-host'] ||
            req.headers.host ||
            `localhost:${PORT}`;
          microserviceUrlFromConfig = `${protocol}://${host}`;
          console.log(
            `Constructed microservice URL: ${microserviceUrlFromConfig}`
          );
        }

        console.log(`Using microservice URL: ${microserviceUrlFromConfig}`);

        // Validate the constructed URL
        try {
          new URL(microserviceUrlFromConfig);
        } catch (urlError) {
          console.warn(
            `Invalid microservice URL constructed: ${microserviceUrlFromConfig}, falling back to null`
          );
          microserviceUrlFromConfig = null;
        }

        let config = {
          liferayUrl: req.body.liferayUrl,
          clientId: req.body.clientId,
          clientSecret: req.body.clientSecret,
          catalogId: parseInt(req.body.catalogId),
          channelId: req.body.channelId ? parseInt(req.body.channelId) : null,
          currencyCode: req.body.currencyCode || 'USD',
          localeCode: req.body.localeCode || 'en-US',
          selectedLanguages: req.body.selectedLanguages || ['en-US'],
          aiModel: req.body.aiModel || 'gpt-4o',
          demoMode: req.body.demoMode || false,
          microserviceUrl:
            req.body.microserviceUrl && req.body.microserviceUrl !== 'null'
              ? req.body.microserviceUrl
              : null,
          pollingDelay: parseInt(req.body.pollingDelay) || 10,
        };

        let options = {
          count: req.body.count || 10,
          categories: req.body.categories || [],
          generatePriceLists: req.body.generatePriceLists || false,
          generateBulkPricing: req.body.generateBulkPricing || false,
          generateTierPricing: req.body.generateTierPricing || false,
          generateImages: req.body.generateImages || false,
          imageWidth: req.body.imageWidth || 1024,
          imageHeight: req.body.imageHeight || 1024,
          imageQuality: req.body.imageQuality || 'standard',
          imageStyle: req.body.imageStyle || 'photographic',
          imageRatio: req.body.imageRatio || 25,
          generateSpecifications: req.body.generateSpecifications || false,
          generateSkuVariants: req.body.generateSkuVariants || false,
          generatePDFs: req.body.generatePDFs || false,
          pdfRatio: req.body.pdfRatio || 10,
          batchSize: parseInt(req.body.batchSize) || 5,
          pollingDelay: parseInt(req.body.pollingDelay) || 10,
          demoMode: req.body.demoMode || false,
          useCustomImage: req.body.useCustomImage || false,
          useCustomPDF: req.body.useCustomPDF || false,
          microserviceUrl:
            req.body.microserviceUrl && req.body.microserviceUrl !== 'null'
              ? req.body.microserviceUrl
              : null,
        };

        logger.info('Starting product generation', {
          correlationId: req.correlationId,
          operation: 'generate-products',
          productCount: actualCount,
          demoMode: !!options.demoMode,
          categories: options.categories?.length || 0,
          microserviceUrl: microserviceUrlFromConfig,
        });

        if (options.demoMode) {
          return handleDemoProductGeneration(req, res);
        }

        if (options.generatePDFs && options.pdfRatio > 0) {
          const expectedPDFs = Math.ceil(
            actualCount * (options.pdfRatio / 100)
          );
          logger.info('PDF generation configured', {
            correlationId: req.correlationId,
            operation: 'generate-products',
            expectedPDFs,
            pdfRatio: options.pdfRatio,
            productCount: actualCount,
          });
        }

        const results = await productGenerator.generateProducts(config, {
          count: actualCount,
          categories: options.categories,
          batchSize: actualBatchSize,
          generateSkuVariants: generateSkuVariants,
          generateSpecifications: generateSpecifications,
          generateAttachments: generateAttachments,
          generatePriceLists: generatePriceLists,
          generateBulkPricing: generateBulkPricing,
          generateTierPricing: generateTierPricing,
          generatePDFs: generatePDFs,
          generateImages: req.body.generateImages,
          pdfRatio: pdfRatio,
          imageRatio: req.body.imageRatio || 0,
          demoMode: demoMode,
        });

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
        if (generatePDFs && results.pdfProgress) {
          global.broadcastProgress({
            type: 'generation-progress',
            generator: 'product',
            subType: 'pdf',
            batchId: results.batchId,
            progress: results.pdfProgress.current / results.pdfProgress.total,
            current: results.pdfProgress.current,
            total: results.pdfProgress.total,
            timestamp: new Date().toISOString(),
          });
        }

        // Emit progress update via WebSocket for Image generation
        if (req.body.generateImages && results.imageProgress) {
          global.broadcastProgress({
            type: 'generation-progress',
            generator: 'product',
            subType: 'image',
            batchId: results.batchId,
            progress:
              results.imageProgress.current / results.imageProgress.total,
            current: results.imageProgress.current,
            total: results.imageProgress.total,
            timestamp: new Date().toISOString(),
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
          configDetails: {
            liferayUrl: config?.liferayUrl,
            catalogId: config?.catalogId,
            clientId: config?.clientId,
            clientSecret: config?.clientSecret ? '[REDACTED]' : undefined,
            aiModel: config?.aiModel,
          },
          optionsDetails: {
            productCount: options?.count,
            batchSize: options?.batchSize,
          },
        });

        console.error('=== PRODUCT GENERATION ERROR DEBUG ===');
        console.error('Error Message:', errorMessage);
        console.error('Error Name:', error.name);
        console.error('Error Type:', typeof error);
        // Log request body with sensitive fields redacted
        const sanitizedBody = { ...req.body };
        if (sanitizedBody.clientSecret)
          sanitizedBody.clientSecret = '[REDACTED]';
        if (sanitizedBody.openaiApiKey)
          sanitizedBody.openaiApiKey = '[REDACTED]';
        if (sanitizedBody.Authorization)
          sanitizedBody.Authorization = '[REDACTED]';
        console.error('Request Body:', JSON.stringify(sanitizedBody, null, 2));
        console.error(
          'Config Object:',
          JSON.stringify(
            req.body.config,
            (key, value) => (key === 'clientSecret' ? '[REDACTED]' : value),
            2
          )
        );
        // Log options with sensitive fields redacted
        const sanitizedOptions = req.body.options
          ? { ...req.body.options }
          : {};
        if (sanitizedOptions.clientSecret)
          sanitizedOptions.clientSecret = '[REDACTED]';
        if (sanitizedOptions.openaiApiKey)
          sanitizedOptions.openaiApiKey = '[REDACTED]';
        console.error(
          'Options Object:',
          JSON.stringify(sanitizedOptions, null, 2)
        );
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
    try {
      const { liferayUrl, clientId, clientSecret, catalogId, requiredCount } =
        req.body;

      const config = {
        liferayUrl,
        clientId,
        clientSecret,
        catalogId: parseInt(catalogId),
      };

      const products = await liferayService.getProducts(
        config,
        config.catalogId
      );

      res.json({
        available: products.length > 0,
        count: products.length,
        required: requiredCount || 1,
        sufficient: products.length >= (requiredCount || 1),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'validate-products',
      });
      res.json({
        available: false,
        count: 0,
        required: req.body.requiredCount || 1,
        sufficient: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/validate/accounts', async (req, res) => {
    try {
      const { liferayUrl, clientId, clientSecret, requiredCount } = req.body;

      const config = {
        liferayUrl,
        clientId,
        clientSecret,
      };

      const accounts = await liferayService.getAccounts(config);

      res.json({
        available: accounts.length > 0,
        count: accounts.length,
        required: requiredCount || 1,
        sufficient: accounts.length >= (requiredCount || 1),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'validate-accounts',
      });
      res.json({
        available: false,
        count: 0,
        required: req.body.requiredCount || 1,
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
      try {
        const {
          liferayUrl,
          clientId,
          clientSecret,
          catalogId,
          channelId,
          currencyCode,
          localeCode,
          aiModel,
          selectedLanguages,
          orderCount,
          batchSize,
          demoMode,
          microserviceUrl,
          pollingDelay,
        } = req.body;

        if (demoMode) {
          return handleDemoOrderGeneration(req, res);
        }

        if (!channelId) {
          return res.status(400).json({
            success: false,
            error: 'channelId is required for order generation',
          });
        }

        if (!currencyCode) {
          return res.status(400).json({
            success: false,
            error: 'currencyCode is required for order generation',
          });
        }

        if (!aiModel) {
          return res.status(400).json({
            success: false,
            error: 'AI model is required',
          });
        }

        if (!batchSize) {
          return res.status(400).json({
            success: false,
            error: 'Batch size is required',
          });
        }

        const productValidation = await liferayService.validateProducts({
          liferayUrl,
          clientId,
          clientSecret,
          catalogId,
          requiredCount: 1,
        });

        if (!productValidation.sufficient) {
          throw new Error(
            `Not enough products available in catalog ${catalogId}. Required: ${productValidation.required}, Available: ${productValidation.count}. Please ensure products are created.`
          );
        }

        const accountValidation = await liferayService.validateAccounts({
          liferayUrl,
          clientId,
          clientSecret,
          requiredCount: 1,
        });

        if (!accountValidation.sufficient) {
          throw new Error(
            `Not enough accounts available. Required: ${accountValidation.required}, Available: ${accountValidation.count}. Please ensure accounts are created.`
          );
        }

        console.log(`Starting order generation: ${orderCount} orders`);

        const config = {
          liferayUrl,
          clientId,
          clientSecret,
          catalogId,
          channelId,
          currencyCode,
          localeCode,
          microserviceUrl: microserviceUrl || req.body.microserviceUrl,
          aiModel,
          selectedLanguages,
          demoMode,
          pollingDelay: pollingDelay,
        };

        const options = {
          count: orderCount,
          batchSize: batchSize,
          catalogId: config.catalogId,
          enableRetry: req.body.enableRetry,
        };

        const results = await orderGenerator.generateOrders(config, {
          count: orderCount,
          batchSize: batchSize,
        });

        // Emit progress update via WebSocket for PDF generation
        if (results.pdfProgress) {
          global.broadcastProgress({
            type: 'generation-progress',
            generator: 'order',
            subType: 'pdf',
            batchId: results.batchId,
            progress: results.pdfProgress.current / results.pdfProgress.total,
            current: results.pdfProgress.current,
            total: results.pdfProgress.total,
            timestamp: new Date().toISOString(),
          });
        }

        // Emit progress update via WebSocket for Image generation
        if (results.imageProgress) {
          global.broadcastProgress({
            type: 'generation-progress',
            generator: 'order',
            subType: 'image',
            batchId: results.batchId,
            progress:
              results.imageProgress.current / results.imageProgress.total,
            current: results.imageProgress.current,
            total: results.imageProgress.total,
            timestamp: new Date().toISOString(),
          });
        }

        res.json({
          success: true,
          count: results.created,
          errors: results.errors,
          data: results.orders,
        });
      } catch (error) {
        logger.errorWithStack(error, {
          correlationId: req.correlationId,
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
