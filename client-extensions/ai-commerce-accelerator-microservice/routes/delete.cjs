const { connectionSchema } = require('../utils/schemas.cjs');
const {
  buildConfigAndOptions,
  sanitizedObject,
} = require('..//utils/normalize.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');

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

        res.status(200).json(summary);
      } catch (error) {
        const errorMessage = error.message ||
          error.toString() ||
          'Unknown error occurred while deleting Commerce data';

        logger.errorWithStack(error, {
          correlationId: config.correlationId,
          operation: 'delete-commerce-data',
          error: errorMessage,
          requestDetails: {
            method: req.method,
            url: req.url,
            body: req.body,
            headers: req.headers,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
          },
          sanitizeConfig: sanitizedObject(config),
          sanitizeOptions: sanitizedObject(options),
        });

        res.status(500).json({
          success: false,
          error: `Failed to delete Commerce data: ${errorMessage}`,
          details: error.stack,
        });
      }
    }
  );
};
