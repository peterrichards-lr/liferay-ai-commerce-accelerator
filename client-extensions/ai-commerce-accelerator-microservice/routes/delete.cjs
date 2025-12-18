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
      await Promise.all([
        configService.getCacheConfig(config),
        configService.getQueueConfig(config),
        configService.getAIConfig(config),
        configService.getAIPromptsConfig(config),
        configService.getOAuthConfig(config),
        configService.getObjectStorageConfig(config),
        configService.getWSConfig(config),
      ]);
      next();
    } catch (error) {
      return handleError(res, logger, req, config, 'load-app-config', error);
    }
  };
}

module.exports = (app, { deleteCoordinatorService, logger, configService }) => {
  const loadAppConfigMiddleware = createLoadAppConfigMiddleware(
    configService,
    logger
  );

  app.post(
    '/api/delete-commerce-data',
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
    '/api/delete-channel-commerce-data',
    inputValidationMiddleware(channelConnectionSchema),
    (req, res, next) => {
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
          operation: 'delete-channel-commerce-data',
          correlationId: config.correlationId,
          summary,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        return handleError(
          res,
          logger,
          req,
          config,
          'delete-channel-commerce-data',
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

