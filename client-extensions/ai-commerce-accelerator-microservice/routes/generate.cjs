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
const {
  handleDemoProductGeneration,
  handleDemoAccountGeneration,
  handleDemoOrderGeneration,
  createERC,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function resolveErrorReference(err) {
  if (!err || typeof err !== 'object') return null;
  if (err.errorReference && typeof err.errorReference === 'string') {
    return err.errorReference;
  }
  if (err.errorRef && typeof err.errorRef === 'string') {
    return err.errorRef;
  }
  if (err.erc && typeof err.erc === 'string') {
    return err.erc;
  }
  if (err.reference && typeof err.reference === 'string') {
    return err.reference;
  }
  return null;
}

function handleError(res, logger, req, config, operation, error, extra = {}) {
  const baseMessage =
    (error && error.message) ||
    (typeof error === 'string' ? error : null) ||
    'An unexpected error occurred. Please try again.';

  const isValidationError =
    baseMessage.includes('Not enough') ||
    baseMessage.includes('required') ||
    baseMessage.includes('No ') ||
    baseMessage.includes('missing') ||
    baseMessage.includes('invalid');

  const isAIKeyError = baseMessage.includes('OpenAI API key not configured');

  let statusCode = isValidationError ? 400 : 500;
  let userMessage = baseMessage;

  if (isAIKeyError) {
    userMessage =
      'AI service error: OpenAI API key not configured. Please set it in the AI Configuration object.';
  }

  const errorRef =
    resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

  logger.error('Operation failed', {
    correlationId: config?.correlationId,
    errorReference: errorRef,
    operation,
    message: baseMessage,
    name: error?.name,
    stack: error?.stack,
    requestDetails: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    },
    ...extra,
  });

  return res.status(statusCode).json({
    success: false,
    error: userMessage,
    errorReference: errorRef,
    demo: !!config?.demoMode,
    timestamp: new Date().toISOString(),
  });
}

module.exports = (
  app,
  { liferayService, productGenerator, accountGenerator, orderGenerator, logger }
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

        res.json({
          success: true,
          batch: !!results.batchId,
          count: results.count || results.created || 0,
          data: results.accounts,
          message: results.message || 'Accounts generated successfully',
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, config, 'generate-accounts', error, {
          sanitizeConfig: sanitizedObject(config),
          sanitizeOptions: sanitizedObject(options),
        });
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
      ].forEach((k) => (b[k] = toBoolean(b[k])));

      next();
    },
    inputValidationMiddleware(generateDataSchema),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);

      try {
        if (options.demoMode) {
          return handleDemoProductGeneration(
            config,
            options,
            productGenerator,
            res
          );
        }

        logger.info('Starting product generation', {
          correlationId: config.correlationId,
          operation: 'generate-products',
        });

        const results = await productGenerator.generateProducts(
          config,
          options
        );

        res.json({
          success: true,
          message: 'Products generated successfully',
          count: results.created || 0,
          products: results.products || [],
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, config, 'generate-products', error, {
          sanitizeConfig: sanitizedObject(config),
          sanitizeOptions: sanitizedObject(options),
        });
      }
    }
  );

  app.post('/api/validate/products', async (req, res) => {
    const { config, options } = buildConfigAndOptions(req);

    try {
      const count = await liferayService.getProductCount(config);

      res.json({
        available: count > 0,
        count,
        required: options.requiredCount || 1,
        sufficient: count >= (options.requiredCount || 1),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleError(res, logger, req, config, 'validate-products', error, {
        sanitizeConfig: sanitizedObject(config),
        sanitizeOptions: sanitizedObject(options),
      });
    }
  });

  app.post('/api/validate/accounts', async (req, res) => {
    const { config, options } = buildConfigAndOptions(req);

    try {
      const count = await liferayService.getAccountCount(config);

      res.json({
        available: count > 0,
        count,
        required: options.requiredCount || 1,
        sufficient: count >= (options.requiredCount || 1),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleError(res, logger, req, config, 'validate-accounts', error, {
        sanitizeConfig: sanitizedObject(config),
        sanitizeOptions: sanitizedObject(options),
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

        const results = await orderGenerator.generateOrders(config, options);

        res.json({
          success: true,
          count: results.created || 0,
          data: results.orders,
          errors: results.errors,
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, config, 'generate-orders', error, {
          sanitizeConfig: sanitizedObject(config),
          sanitizeOptions: sanitizedObject(options),
        });
      }
    }
  );
};
