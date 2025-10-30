const { connectionSchema } = require('../utils/schemas.cjs');
const {
  buildConfigAndOptions,
  sanitizedObject,
} = require('../utils/normalize.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

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
  const errorRef = resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

  const errorMessage =
    (error && error.message) ||
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

module.exports = (app, { deleteCoordinatorService, logger }) => {
  app.post(
    '/api/delete-commerce-data',
    inputValidationMiddleware(connectionSchema),
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
};