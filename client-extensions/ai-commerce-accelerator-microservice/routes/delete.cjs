const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const {
  connectionSchema,
  channelConnectionSchema,
} = require('../utils/schemas.cjs');
const {
  buildConfigAndOptions,
  sanitizedObject,
} = require('../utils/normalize.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

function handleError(res, logger, req, config, operation, error, extra = {}) {
  const errorRef = resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

  const errorMessage =
    error?.message ||
    (typeof error === 'string' ? error : null) ||
    'An unexpected error occurred. Please try again.';

  logger.error('Operation failed', {
    correlationId: config?.correlationId,
    errorReference: errorRef,
    operation,
    message: errorMessage,
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

  return res.status(500).json({
    success: false,
    error: errorMessage,
    errorReference: errorRef,
    demo: !!config?.demoMode,
    timestamp: new Date().toISOString(),
  });
}

function createLoadAppConfigMiddleware(configService, logger) {
  return async function loadAppConfigMiddleware(req, res, next) {
    const { config } = req;

    try {
      // Load critical configs required for basic operation (Auth, Cache)
      await Promise.all([
        configService.getCacheConfig(config),
        configService.getOAuthConfig(config),
      ]);
    } catch (error) {
      return handleError(
        res,
        logger,
        req,
        config,
        'load-app-config-critical',
        error
      );
    }

    try {
      // Load secondary configs (AI, Queues, etc.) gracefully.
      // Teardown should not be blocked if the AI configuration is broken or missing.
      await Promise.all([
        configService
          .getQueueConfig(config)
          .catch((e) =>
            logger.warn(
              `Failed to load Queue config during delete middleware: ${e.message}`
            )
          ),
        configService
          .getAIConfig(config)
          .catch((e) =>
            logger.warn(
              `Failed to load AI config during delete middleware: ${e.message}`
            )
          ),
        configService
          .getAIPromptsConfig(config)
          .catch((e) =>
            logger.warn(
              `Failed to load AI Prompts config during delete middleware: ${e.message}`
            )
          ),
        configService
          .getObjectStorageConfig(config)
          .catch((e) =>
            logger.warn(
              `Failed to load Object Storage config during delete middleware: ${e.message}`
            )
          ),
        configService
          .getWSConfig(config)
          .catch((e) =>
            logger.warn(
              `Failed to load WS config during delete middleware: ${e.message}`
            )
          ),
      ]);
    } catch (error) {
      logger.warn(
        `Non-critical config load error during delete middleware: ${error.message}`
      );
    }

    next();
  };
}

module.exports = (app, { deleteCoordinatorService, logger, configService }) => {
  const loadAppConfigMiddleware = createLoadAppConfigMiddleware(
    configService,
    logger
  );

  app.post(
    INTERNAL_API_PATHS.DELETE_COMMERCE_DATA,
    inputValidationMiddleware(connectionSchema),
    (req, res, next) => {
      req.config = buildConfigAndOptions(req).config;
      next();
    },
    loadAppConfigMiddleware,
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);

      try {
        const summary = await deleteCoordinatorService.runDeleteAndMonitor(
          config,
          options
        );

        res.status(200).json({
          success: true,
          operation: 'delete-commerce-data',
          correlationId: config.correlationId,
          sessionId: summary.sessionId,
          summary,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        return handleError(
          res,
          logger,
          req,
          config,
          'delete-commerce-data',
          error,
          {
            sanitizeConfig: sanitizedObject(config),
            sanitizeOptions: sanitizedObject(options),
          }
        );
      }
    }
  );

  app.post(
    INTERNAL_API_PATHS.DELETE_SELECTED_COMMERCE_DATA,
    inputValidationMiddleware(channelConnectionSchema),
    async (req, res, next) => {
      req.config = buildConfigAndOptions(req).config;
      next();
    },
    loadAppConfigMiddleware,
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);
      const { channelId, catalogId, deleteScope } = req.body;

      try {
        const summary =
          await deleteCoordinatorService.runDeleteSelectedAndMonitor(
            config,
            options,
            { channelId, catalogId, deleteScope }
          );

        res.status(200).json({
          success: true,
          operation: 'delete-selected-commerce-data',
          correlationId: config.correlationId,
          sessionId: summary.sessionId,
          summary,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        return handleError(
          res,
          logger,
          req,
          config,
          'delete-selected-commerce-data',
          error,
          {
            sanitizeConfig: sanitizedObject(config),
            sanitizeOptions: sanitizedObject(options),
          }
        );
      }
    }
  );
};
