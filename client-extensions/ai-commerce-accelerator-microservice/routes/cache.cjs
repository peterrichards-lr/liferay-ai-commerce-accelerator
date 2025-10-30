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
  return null;
}

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

module.exports = (app, { logger, cacheService }) => {
  app.get('/api/cache/stats', async (req, res) => {
    try {
      const stats = cacheService.getStats();
      res.json({
        success: true,
        stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'cache-stats',
        meta: {},
        statusCode: 500,
        fallbackMessage: 'Failed to get cache stats',
      });
    }
  });

  app.get('/api/cache/entries', async (req, res) => {
    try {
      const stats = cacheService.getStats(true);
      res.json({
        success: true,
        stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'cache-entries',
        meta: {},
        statusCode: 500,
        fallbackMessage: 'Failed to get cache entries',
      });
    }
  });
};
