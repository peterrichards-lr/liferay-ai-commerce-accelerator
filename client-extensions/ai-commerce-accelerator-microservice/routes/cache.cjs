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

module.exports = (app, { logger, cacheService }) => {
  app.get(INTERNAL_API_PATHS.CACHE_STATS, async (req, res) => {
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

  app.get(INTERNAL_API_PATHS.CACHE_ENTRIES, async (req, res) => {
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

  app.delete(INTERNAL_API_PATHS.CACHE_CLEAR, async (req, res) => {
    try {
      cacheService.clear();
      res.json({
        success: true,
        message: 'Cache cleared successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'cache-clear',
        meta: {},
        statusCode: 500,
        fallbackMessage: 'Failed to clear cache',
      });
    }
  });

  app.delete(INTERNAL_API_PATHS.CACHE_CLEANUP, async (req, res) => {
    try {
      let { cutoff } = req.query;
      
      if (!cutoff) {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        cutoff = midnight.toISOString();
      }

      cacheService.cleanupSelective(cutoff);

      res.json({
        success: true,
        message: `Cache entries created before ${cutoff} cleared successfully`,
        cutoff,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'cache-cleanup',
        meta: { cutoff: req.query.cutoff },
        statusCode: 500,
        fallbackMessage: 'Failed to cleanup cache',
      });
    }
  });
};
