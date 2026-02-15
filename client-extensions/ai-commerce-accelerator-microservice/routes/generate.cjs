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
    liferayRestService,
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

        if (options.productCount > 0) {
          steps.push({ name: 'generate-warehouses', type: 'sync' });
          steps.push({ name: 'product-data-generation', type: 'sync' });
          steps.push({ name: 'products', type: 'sync' });
          steps.push({
            type: 'parallel',
            steps: [
              { name: 'attach-images', type: 'sync' },
              { name: 'attach-pdfs', type: 'sync' },
              { name: 'update-inventory', type: 'sync' },
            ],
          });
        }

        if (options.accountCount > 0) {
          steps.push({ name: 'load-countries', type: 'sync' });
          steps.push({ name: 'account-data-generation', type: 'sync' });
          steps.push({ name: 'accounts', type: 'sync' });
          steps.push({ name: 'postal-addresses', type: 'sync' });
          steps.push({
            name: 'set-billing-and-shipping-addresses',
            type: 'sync',
          });
        }

        if (options.orderCount > 0) {
          steps.push({ name: 'order-data-generation', type: 'sync' });
          steps.push({ name: 'orders', type: 'sync' });
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
