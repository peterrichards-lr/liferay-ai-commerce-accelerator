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
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');
const { resolveErrorReference, createERC } = require('../utils/misc.cjs');

const S = WORKFLOW_STEPS;

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
          productSteps.push({ name: S.CREATE_WAREHOUSES, type: 'sync' });
          productSteps.push({ name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' });
          productSteps.push({ name: S.GENERATE_PRODUCT_DATA, type: 'sync' });
          productSteps.push({ name: S.CREATE_PRODUCTS, type: 'sync' });
          productSteps.push({ name: S.RESOLVE_PRODUCT_IDS, type: 'sync' });
          productSteps.push({ name: S.LINK_PRODUCT_OPTIONS, type: 'sync' });
          productSteps.push({ name: S.CREATE_PRODUCT_SKUS, type: 'sync' });
          productSteps.push({ name: S.RESOLVE_SKU_IDS, type: 'sync' });
          productSteps.push({ name: S.SYNC_DELAY, type: 'sync' });
          productSteps.push({ name: S.GENERATE_PRICE_LISTS, type: 'sync' });

          if (options.generatePriceLists) {
            productSteps.push({ name: S.UPDATE_CATALOG_CONFIG, type: 'sync' });
          }

          if (options.generateBulkPricing) {
            productSteps.push({ name: S.GENERATE_BULK_PRICING, type: 'sync' });
          }

          if (options.generateTierPricing) {
            productSteps.push({ name: S.GENERATE_TIER_PRICING, type: 'sync' });
          }

          productSteps.push({
            type: 'parallel',
            steps: [
              { name: S.ATTACH_IMAGES, type: 'sync' },
              { name: S.ATTACH_PDFS, type: 'sync' },
              { name: S.UPDATE_INVENTORY, type: 'sync' },
            ],
          });
        }

        if (options.accountCount > 0) {
          accountSteps.push({ name: S.LOAD_COUNTRIES, type: 'sync' });
          accountSteps.push({ name: S.GENERATE_ACCOUNT_DATA, type: 'sync' });
          accountSteps.push({ name: S.CREATE_ACCOUNTS, type: 'sync' });
          accountSteps.push({ name: S.RESOLVE_ACCOUNT_IDS, type: 'sync' });
          accountSteps.push({ name: S.CREATE_POSTAL_ADDRESSES, type: 'sync' });
          accountSteps.push({ name: S.SET_ADDRESS_DEFAULTS, type: 'sync' });
        }

        if (options.orderCount > 0) {
          orderSteps.push({ name: S.GENERATE_ORDER_DATA, type: 'sync' });
          orderSteps.push({ name: S.CREATE_ORDERS, type: 'sync' });
        }

        // COMPOSE WORKFLOW WITH CLEAR DEPENDENCIES
        if (productSteps.length > 0 || accountSteps.length > 0) {
          steps.push({
            type: 'parallel',
            steps: [
              ...(productSteps.length > 0
                ? [
                    {
                      name: 'subflow-products',
                      type: 'sequence',
                      steps: productSteps,
                    },
                  ]
                : []),
              ...(accountSteps.length > 0
                ? [
                    {
                      name: 'subflow-accounts',
                      type: 'sequence',
                      steps: accountSteps,
                    },
                  ]
                : []),
            ],
          });
        }

        // Orders only start after products and accounts subflows are terminal
        if (orderSteps.length > 0) {
          steps.push({
            name: 'subflow-orders',
            type: 'sequence',
            steps: orderSteps,
          });
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
