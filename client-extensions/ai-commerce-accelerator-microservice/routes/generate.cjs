const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
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
    persistenceService,
    batchCallbackService,
  }
) => {
  app.post(
    INTERNAL_API_PATHS.GENERATE_WORKFLOW,
    upload.fields([{ name: 'customImageFile' }, { name: 'customPDFFile' }]),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);
      config.demoMode = options.demoMode;

      try {
        const steps = [];
        let flowType = 'generate';

        const productSteps = [];
        const accountSteps = [];
        const orderSteps = [];

        if (options.productCount > 0) {
          productSteps.push({ name: 'generate-warehouses', type: 'sync' });
          productSteps.push({ name: 'resolve-warehouse-ids', type: 'sync' });
          productSteps.push({ name: 'product-data-generation', type: 'sync' });
          productSteps.push({ name: 'products', type: 'sync' });
          productSteps.push({ name: 'resolve-product-ids', type: 'sync' });
          productSteps.push({ name: 'link-product-options', type: 'sync' });
          productSteps.push({ name: 'product-skus', type: 'sync' });
          productSteps.push({ name: 'resolve-sku-ids', type: 'sync' });
          productSteps.push({ name: 'generate-price-lists', type: 'sync' });

          if (options.generatePriceLists) {
            productSteps.push({
              name: 'update-catalog-configuration',
              type: 'sync',
            });
          }

          if (options.generateBulkPricing) {
            productSteps.push({ name: 'generate-bulk-pricing', type: 'sync' });
          }

          if (options.generateTierPricing) {
            productSteps.push({ name: 'generate-tier-pricing', type: 'sync' });
          }

          productSteps.push({
            type: 'parallel',
            steps: [
              { name: 'attach-images', type: 'sync' },
              { name: 'attach-pdfs', type: 'sync' },
              { name: 'update-inventory', type: 'sync' },
            ],
          });
        }

        if (options.accountCount > 0) {
          accountSteps.push({ name: 'load-countries', type: 'sync' });
          accountSteps.push({ name: 'account-data-generation', type: 'sync' });
          accountSteps.push({ name: 'accounts', type: 'sync' });
          accountSteps.push({ name: 'resolve-account-ids', type: 'sync' });
          accountSteps.push({ name: 'postal-addresses', type: 'sync' });
          accountSteps.push({
            name: 'set-billing-and-shipping-addresses',
            type: 'sync',
          });
        }

        if (options.orderCount > 0) {
          orderSteps.push({ name: 'order-data-generation', type: 'sync' });
          orderSteps.push({ name: 'orders', type: 'sync' });
        }

        // COMPOSE WORKFLOW WITH CLEAR DEPENDENCIES
        if (productSteps.length > 0 || accountSteps.length > 0) {
          steps.push({
            type: 'parallel',
            steps: [
              ...(productSteps.length > 0
                ? [{ name: 'subflow-products', steps: productSteps }]
                : []),
              ...(accountSteps.length > 0
                ? [{ name: 'subflow-accounts', steps: accountSteps }]
                : []),
            ],
          });
        }

        // Orders only start after products and accounts subflows are terminal
        if (orderSteps.length > 0) {
          steps.push(...orderSteps);
        }

        if (
          options.accountCount > 0 &&
          !options.productCount &&
          !options.orderCount
        ) {
          flowType = 'accounts';
        } else if (
          options.orderCount > 0 &&
          !options.productCount &&
          !options.accountCount
        ) {
          flowType = 'orders';
        }

        if (steps.length === 0) {
          return res.json({
            success: false,
            error: 'No generation options selected.',
          });
        }

        const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

        await persistenceService.createSession({
          sessionId,
          flowType: flowType,
          status: 'STARTED',
          currentSteps: [],
          correlationId: config.correlationId,
          context: {
            config,
            options,
            steps,
          },
        });

        batchCallbackService._checkSessionCompletion(
          sessionId,
          config.correlationId
        );

        logger.info('Generation workflow started', {
          correlationId: config.correlationId,
          sessionId,
        });

        return res.json({
          success: true,
          sessionId,
          message: 'Generation workflow started successfully.',
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const errorReference =
          resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

        emitRouteError(progressService, {
          error,
          fallbackMessage: 'Generation workflow failed to start',
          operation: 'generate-workflow',
          entityType: 'workflow',
          correlationId: config.correlationId,
          errorReference,
        });

        return handleError(
          res,
          logger,
          req,
          config,
          'generate-workflow',
          Object.assign(error, { errorReference }),
          {
            entityType: 'workflow',
            sanitizeConfig: sanitizedObject(config),
            sanitizeOptions: sanitizedObject(options),
          }
        );
      }
    }
  );
};
