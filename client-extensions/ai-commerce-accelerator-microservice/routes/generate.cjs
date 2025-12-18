const multer = require('multer');
const {
  toBoolean,
  toNumber,
  parseMaybeJSON,
  buildConfigAndOptions,
  sanitizedObject,
} = require('../utils/normalize.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const {
  generateDataSchema,
  generateOrdersSchema,
  generateAccountsSchema,
} = require('../utils/schemas.cjs');
const { handleError } = require('../utils/handleErrorHelper.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { resolveErrorReference, createERC } = require('../utils/misc.cjs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function emitRouteError(
  progressService,
  {
    error,
    fallbackMessage,
    operation,
    entityType,
    correlationId,
    errorReference,
  }
) {
  const uiMessage =
    error?.userMessage ||
    error?.message ||
    fallbackMessage ||
    'An unexpected error occurred';

  if (progressService && typeof progressService.sessionFailed === 'function') {
    progressService.sessionFailed({
      correlationId,
      error: Object.assign(error, { message: uiMessage, errorReference }),
      entityType,
      operation,
    });
  }
}

module.exports = (
  app,
  {
    liferayService,
    productGenerator,
    accountGenerator,
    orderGenerator,
    warehouseGenerator,
    configService,
    cacheService,
    logger,
    progressService,
  }
) => {
  app.post(
    '/api/generate/accounts',
    async (req, res, next) => {
      const { config } = buildConfigAndOptions(req);
      const { aiModelOptions } = await configService.getAIModelOptions(config);
      const batchSizes = await configService.getBatchSizes(config);
      req.aiModelOptions = aiModelOptions;
      req.batchSizes = batchSizes;
      inputValidationMiddleware(
        generateAccountsSchema(aiModelOptions, batchSizes)
      )(req, res, next);
    },
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);
      config.demoMode = options.demoMode;

      try {
        logger.info('Account generation request received', {
          correlationId: config.correlationId,
          operation: 'generate-accounts',
        });

        const configPromises = [
          configService.getCacheConfig(config),
          configService.getQueueConfig(config),
          configService.getOAuthConfig(config),
          configService.getObjectStorageConfig(config),
          configService.getWSConfig(config),
        ];

        if (!options.demoMode) {
          configPromises.push(configService.getAIConfig(config));
          configPromises.push(configService.getAIPromptsConfig(config));
        }

        await Promise.all(configPromises);

        const results = await accountGenerator.generateAccounts(
          config,
          options
        );

        return res.json({
          success: true,
          batch: !!results.batchId,
          count: results.count || results.created || 0,
          data: results.accounts,
          message: results.message || 'Accounts generated successfully',
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const errorReference =
          resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

        emitRouteError(progressService, {
          error,
          fallbackMessage: 'Account generation failed',
          operation: 'generate-accounts',
          entityType: 'accounts',
          correlationId: config.correlationId,
          errorReference,
        });

        return handleError(
          res,
          logger,
          req,
          config,
          'generate-accounts',
          Object.assign(error, { errorReference }),
          {
            entityType: 'accounts',
            sanitizeConfig: sanitizedObject(config),
            sanitizeOptions: sanitizedObject(options),
          }
        );
      }
    }
  );

  app.post(
    '/api/generate/products',
    upload.fields([{ name: 'customImageFile' }, { name: 'customPDFFile' }]),
    async (req, res, next) => {
      const b = req.body || {};

      if (b.categories) b.categories = parseMaybeJSON(b.categories) || [];
      if (b.selectedLanguages)
        b.selectedLanguages = parseMaybeJSON(b.selectedLanguages) || [];
      if (b.productCategories)
        b.productCategories = parseMaybeJSON(b.productCategories) || [];

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

      [
        'generatePriceLists',
        'generateBulkPricing',
        'generateTierPricing',
        'generateSpecifications',
        'generateSkuVariants',
        'demoMode',
        'createWarehouses',
        'reuseExistingWarehouses',
      ].forEach((k) => (b[k] = toBoolean(b[k])));

      const { config } = buildConfigAndOptions(req);
      const { aiModelOptions } = await configService.getAIModelOptions(config);
      const batchSizes = await configService.getBatchSizes(config);
      req.aiModelOptions = aiModelOptions;
      req.batchSizes = batchSizes;

      inputValidationMiddleware(generateDataSchema(aiModelOptions, batchSizes))(
        req,
        res,
        next
      );
    },
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);
      config.demoMode = options.demoMode;
      const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

      try {
        const configPromises = [
          configService.getCacheConfig(config),
          configService.getQueueConfig(config),
          configService.getOAuthConfig(config),
          configService.getObjectStorageConfig(config),
          configService.getWSConfig(config),
        ];

        if (!options.demoMode) {
          configPromises.push(configService.getAIConfig(config));
          configPromises.push(configService.getAIPromptsConfig(config));
        }

        await Promise.all(configPromises);

        logger.info('Starting product generation', {
          correlationId: config.correlationId,
          operation: 'generate-products',
        });

        const results = await productGenerator.generateProducts(
          config,
          options
        );

        return res.json({
          success: true,
          message: 'Products generated successfully',
          count: results.created || 0,
          products: results.products || [],
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const errorReference =
          resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

        emitRouteError(progressService, {
          error,
          fallbackMessage: 'Product generation failed',
          operation: 'generate-products',
          entityType: 'products',
          correlationId: config.correlationId,
          errorReference,
        });

        return handleError(
          res,
          logger,
          req,
          config,
          'generate-products',
          Object.assign(error, { errorReference }),
          {
            entityType: 'products',
            sanitizeConfig: sanitizedObject(config),
            sanitizeOptions: sanitizedObject(options),
          }
        );
      }
    }
  );

  app.post('/api/validate/products', async (req, res) => {
    const { config, options } = buildConfigAndOptions(req);

    try {
      await Promise.all([
        configService.getCacheConfig(config),
        configService.getQueueConfig(config),
        configService.getAIConfig(config),
        configService.getAIPromptsConfig(config),
        configService.getOAuthConfig(config),
        configService.getObjectStorageConfig(config),
        configService.getWSConfig(config),
      ]);

      const count = await liferayService.getProductCount(config);

      return res.json({
        available: count > 0,
        count,
        required: options.requiredCount || 1,
        sufficient: count >= (options.requiredCount || 1),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const errorReference =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

      emitRouteError(progressService, {
        error,
        fallbackMessage: 'Product validation failed',
        operation: 'validate-products',
        entityType: 'products',
        correlationId: config.correlationId,
        errorReference,
      });

      return handleError(
        res,
        logger,
        req,
        config,
        'validate-products',
        Object.assign(error, { errorReference }),
        {
          entityType: 'products',
          sanitizeConfig: sanitizedObject(config),
          sanitizeOptions: sanitizedObject(options),
        }
      );
    }
  });

  app.post('/api/validate/accounts', async (req, res) => {
    const { config, options } = buildConfigAndOptions(req);

    try {
      await Promise.all([
        configService.getCacheConfig(config),
        configService.getQueueConfig(config),
        configService.getAIConfig(config),
        configService.getAIPromptsConfig(config),
        configService.getOAuthConfig(config),
        configService.getObjectStorageConfig(config),
        configService.getWSConfig(config),
      ]);

      const count = await liferayService.getAccountCount(config);

      return res.json({
        available: count > 0,
        count,
        required: options.requiredCount || 1,
        sufficient: count >= (options.requiredCount || 1),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const errorReference =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

      emitRouteError(progressService, {
        error,
        fallbackMessage: 'Account validation failed',
        operation: 'validate-accounts',
        entityType: 'accounts',
        correlationId: config.correlationId,
        errorReference,
      });

      return handleError(
        res,
        logger,
        req,
        config,
        'validate-accounts',
        Object.assign(error, { errorReference }),
        {
          entityType: 'accounts',
          sanitizeConfig: sanitizedObject(config),
          sanitizeOptions: sanitizedObject(options),
        }
      );
    }
  });

  app.post(
    '/api/generate/orders',
    async (req, res, next) => {
      const { config } = buildConfigAndOptions(req);
      const { aiModelOptions } = await configService.getAIModelOptions(config);
      const batchSizes = await configService.getBatchSizes(config);
      req.aiModelOptions = aiModelOptions;
      req.batchSizes = batchSizes;
      inputValidationMiddleware(
        generateOrdersSchema(aiModelOptions, batchSizes)
      )(req, res, next);
    },
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);
      config.demoMode = options.demoMode;

      try {
        const configPromises = [
          configService.getCacheConfig(config),
          configService.getQueueConfig(config),
          configService.getOAuthConfig(config),
          configService.getObjectStorageConfig(config),
          configService.getWSConfig(config),
        ];

        if (!options.demoMode) {
          configPromises.push(configService.getAIConfig(config));
          configPromises.push(configService.getAIPromptsConfig(config));
        }

        await Promise.all(configPromises);

        const results = await orderGenerator.generateOrders(config, options);

        return res.json({
          success: true,
          count: results.created || 0,
          data: results.orders,
          errors: results.errors,
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const errorReference =
          resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

        emitRouteError(progressService, {
          error,
          fallbackMessage: 'Order generation failed',
          operation: 'generate-orders',
          entityType: 'orders',
          correlationId: config.correlationId,
          errorReference,
        });

        return handleError(
          res,
          logger,
          req,
          config,
          'generate-orders',
          Object.assign(error, { errorReference }),
          {
            entityType: 'orders',
            sanitizeConfig: sanitizedObject(config),
            sanitizeOptions: sanitizedObject(options),
          }
        );
      }
    }
  );
};
