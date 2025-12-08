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
  getWs,
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

  getWs().emitError({
    correlationId,
    errorReference,
    error: uiMessage,
    operation,
    entityType,
    timestamp: new Date().toISOString(),
  });
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
    logger,
    getWs,
  }
) => {
  app.post(
    '/api/generate/accounts',
    inputValidationMiddleware(generateAccountsSchema),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);

      try {
        logger.info('Account generation request received', {
          correlationId: config.correlationId,
          operation: 'generate-accounts',
        });

        await Promise.all([
          configService.getCacheConfig(config),
          configService.getBatchPollingConfig(config),
          configService.getQueueConfig(config),
          configService.getAIConfig(config),
          configService.getAIPromptsConfig(config),
          configService.getOAuthConfig(config),
          configService.getObjectStorageConfig(config),
          configService.getWSConfig(config),
        ]);

        if (config.demoMode) {
          try {
            logger.info('Demo account generation started', {
              correlationId: config.correlationId,
              operation: 'demo-generate-accounts',
              accountCount: options.accountCount,
              batchSize: config.batchSize,
              pollingDelay: config.pollingDelay,
            });

            const result = await accountGenerator.generateAccounts(
              config,
              options
            );

            const batchIds =
              Array.isArray(result.accounts) && result.accounts.length > 0
                ? result.accounts.map((b) => b.batchId).filter(Boolean)
                : [];

            return res.json({
              success: true,
              count: result.created || 0,
              errors: result.errors || [],
              data: result.accounts || [],
              demo: true,
              batch: batchIds.length > 0,
              batchIds: batchIds.length > 0 ? batchIds : undefined,
            });
          } catch (error) {
            const errorReference =
              resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

            emitRouteError(getWs, {
              error,
              fallbackMessage: 'Demo account generation failed',
              operation: 'demo-generate-accounts',
              entityType: 'accounts',
              correlationId: config.correlationId,
              errorReference,
            });

            return handleError(
              res,
              logger,
              req,
              config,
              'demo-generate-accounts',
              Object.assign(error, { errorReference }),
              {
                entityType: 'accounts',
                sanitizeConfig: sanitizedObject(config),
                sanitizeOptions: sanitizedObject(options),
              }
            );
          }
        }

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

        emitRouteError(getWs, {
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
    (req, _res, next) => {
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

      next();
    },
    inputValidationMiddleware(generateDataSchema),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);

      try {
        await Promise.all([
          configService.getCacheConfig(config),
          configService.getBatchPollingConfig(config),
          configService.getQueueConfig(config),
          configService.getAIConfig(config),
          configService.getAIPromptsConfig(config),
          configService.getOAuthConfig(config),
          configService.getObjectStorageConfig(config),
          configService.getWSConfig(config),
        ]);

        if (options.createWarehouses) {
          let warehouses = [];
          if (options.reuseExistingWarehouses) {
            const existingWarehouses = await liferayService.getWarehouses(config);
            warehouses = (existingWarehouses && existingWarehouses.items) || [];
          }

          const warehouseCount = options.warehouseCount || 1;
          if (warehouses.length < warehouseCount) {
            const newWarehouseCount = warehouseCount - warehouses.length;
            const newWarehouses = await warehouseGenerator.createWarehouses(
              config,
              { ...options, warehouseCount: newWarehouseCount }
            );
            warehouses.push(...newWarehouses);
          }
          options.warehouses = warehouses;
          cacheService.set('generated-warehouses', warehouses);
        }


        if (options.demoMode) {
          try {
            logger.trace(
              `Demo mode: Generating ${options.productCount} mock products using service`,
              {
                correlationId: config.correlationId,
                operation: 'demo-generate-products',
              }
            );

            const result = await productGenerator.generateProducts(
              config,
              options
            );

            const expectedPDFs =
              options.pdfMode !== 'none' && options.pdfRatio > 0
                ? Math.ceil((options.productCount * options.pdfRatio) / 100)
                : 0;

            const expectedImages =
              options.imageMode !== 'none' && options.imageRatio > 0
                ? Math.ceil((options.productCount * options.imageRatio) / 100)
                : 0;

            const firstBatchWithId = Array.isArray(result.products)
              ? result.products.find((p) => p && p.batchId)
              : null;

            return res.json({
              success: true,
              batchId: firstBatchWithId ? firstBatchWithId.batchId : undefined,
              count: result.created || 0,
              pdfCount: expectedPDFs,
              imageCount: expectedImages,
              errors: result.errors || [],
              status: firstBatchWithId ? firstBatchWithId.status : 'completed',
              demo: true,
              batch: Boolean(firstBatchWithId),
            });
          } catch (error) {
            const errorReference =
              resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

            emitRouteError(getWs, {
              error,
              fallbackMessage: 'Demo product generation failed',
              operation: 'demo-generate-products',
              entityType: 'products',
              correlationId: config.correlationId,
              errorReference,
            });

            return handleError(
              res,
              logger,
              req,
              config,
              'demo-generate-products',
              Object.assign(error, { errorReference }),
              {
                entityType: 'products',
                sanitizeConfig: sanitizedObject(config),
                sanitizeOptions: sanitizedObject(options),
              }
            );
          }
        }

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

        emitRouteError(getWs, {
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
        configService.getBatchPollingConfig(config),
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

      emitRouteError(getWs, {
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
        configService.getBatchPollingConfig(config),
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

      emitRouteError(getWs, {
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
    inputValidationMiddleware(generateOrdersSchema),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);

      try {
        await Promise.all([
          configService.getCacheConfig(config),
          configService.getBatchPollingConfig(config),
          configService.getQueueConfig(config),
          configService.getAIConfig(config),
          configService.getAIPromptsConfig(config),
          configService.getOAuthConfig(config),
          configService.getObjectStorageConfig(config),
          configService.getWSConfig(config),
        ]);

        if (options.demoMode) {
          try {
            logger.trace(
              `Demo mode: Generating ${options.orderCount} mock orders via OrderGenerator`,
              {
                correlationId: config.correlationId,
                operation: 'demo-generate-orders',
              }
            );

            const result = await orderGenerator.generateOrders(config, options);

            return res.json({
              success: true,
              count: result.created,
              errors: result.errors || [],
              data: result.orders || [],
              demo: true,
            });
          } catch (error) {
            const errorReference =
              resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

            emitRouteError(getWs, {
              error,
              fallbackMessage: 'Demo order generation failed',
              operation: 'demo-generate-orders',
              entityType: 'orders',
              correlationId: config.correlationId,
              errorReference,
            });

            return handleError(
              res,
              logger,
              req,
              config,
              'demo-generate-orders',
              Object.assign(error, { errorReference }),
              {
                entityType: 'orders',
                sanitizeConfig: sanitizedObject(config),
                sanitizeOptions: sanitizedObject(options),
              }
            );
          }
        }

        if (!config.channelId || !config.currencyCode || !config.batchSize) {
          throw new Error('Missing required parameters for order generation.');
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
            `Not enough products available in catalog ${config.catalogId}. Required: ${productValidation.required}, Available: ${productValidation.count}.`
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
            `Not enough accounts available. Required: ${accountValidation.required}, Available: ${accountValidation.count}.`
          );
        }

        const warehouses = cacheService.get('generated-warehouses');
        if (warehouses) {
          options.warehouses = warehouses;
        }

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

        emitRouteError(getWs, {
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
