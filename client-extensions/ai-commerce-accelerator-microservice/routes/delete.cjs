const { DEBUG } = require('../utils/constants.cjs');
const { connectionSchema } = require('../utils/schemas.cjs');
const {
  runDeleteAndMonitor,
} = require('../services/deleteCoordinatorService.cjs');
const {
  buildConfigAndOptions,
  sanitizedObject,
} = require('..//utils/normalize.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');

module.exports = function (app, liferayService, logger) {
  app.post(
    '/api/delete-commerce-data',
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);

      try {
        const summary = await runDeleteAndMonitor(
          liferayService,
          config,
          options
        );

        res.status(200).json(summary);
      } catch (error) {
        const errorMessage =
          error.message ||
          error.toString() ||
          'Unknown error occurred while deleting Commerce data';

        logger.error('Failed to delete Commerce data - Enhanced Debug Info', {
          correlationId: config.correlationId,
          operation: 'delete-commerce-data',
          error: errorMessage,
          errorName: error.name || 'UnknownError',
          errorStack: error.stack,
          errorType: typeof error,
          errorDetails: error,
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

        if (DEBUG) {
          logger.debug('=== DELETE COMMERCE DATA ERROR DEBUG ===');
          logger.debug('Error Message:', errorMessage);
          logger.debug('Error Name:', error.name);
          logger.debug('Error Type:', typeof error);
          const sanitizedBody = sanitizedObject(req.body);
          logger.debug('Request Body:', JSON.stringify(sanitizedBody, null, 2));
          logger.debug('Full Error Object:', JSON.stringify(error, null, 2));
          logger.debug('Error Stack:', error.stack);
          logger.debug('=== END ERROR DEBUG ===');
        }

        res.status(500).json({
          success: false,
          error: `Failed to delete Commerce data: ${errorMessage}`,
          details: error.stack,
        });
      }
    }
  );
};
