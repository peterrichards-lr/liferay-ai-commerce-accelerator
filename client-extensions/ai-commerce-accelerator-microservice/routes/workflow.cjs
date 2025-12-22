const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

function safeErrorResponse({
  res,
  logger,
  req,
  error,
  operation,
  meta = {},
  statusCode = 500,
  fallbackMessage = 'Unexpected server error',
}) {
  const existingERC = resolveErrorReference(error);
  const errorReference = existingERC || createERC(ERC_PREFIX.ERROR);

  const message =
    (error && error.message) ||
    (typeof error === 'string' ? error : null) ||
    fallbackMessage;

  logger.errorWithStack?.(error, {
    errorReference,
    operation,
    correlationId: req.correlationId,
    errorMessage: message,
    requestDetails: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    },
    ...meta,
  });

  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      error: message,
      errorReference,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = (app, { logger, persistenceService }) => {
  app.get(INTERNAL_API_PATHS.WORKFLOW_SESSIONS, async (req, res) => {
    try {
      const sessions = await persistenceService.getAllSessions();
      res.json({
        success: true,
        sessions,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-sessions',
        meta: {},
        statusCode: 500,
        fallbackMessage: 'Failed to get workflow sessions',
      });
    }
  });

  app.get(INTERNAL_API_PATHS.WORKFLOW_BATCHES, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const batches = await persistenceService.getBatchesForSession(sessionId);
      res.json({
        success: true,
        batches,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-batches',
        meta: { sessionId: req.params.sessionId },
        statusCode: 500,
        fallbackMessage: 'Failed to get workflow batches',
      });
    }
  });
};
