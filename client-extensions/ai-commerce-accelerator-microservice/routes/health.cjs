const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

function resolveErrorRef(err) {
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

function handleError(res, logger, req, operation, error, statusCodeOverride) {
  const errorReference =
    resolveErrorRef(error) || createERC(ERC_PREFIX.ERROR);

  const message =
    (error && error.message) ||
    (typeof error === 'string' ? error : null) ||
    'Internal service error';

  logger.error('Operation failed', {
    correlationId: req.correlationId,
    operation,
    errorReference,
    message,
    name: error?.name,
    stack: error?.stack,
  });

  const statusCode = statusCodeOverride || 503;

  return res.status(statusCode).json({
    success: false,
    status: 'unhealthy',
    message,
    errorReference,
    timestamp: new Date().toISOString(),
  });
}

module.exports = (app, { logger, healthService }) => {
  app.get('/api/health', async (req, res) => {
    try {
      const health = await healthService.runAllHealthChecks();

      const statusCode =
        health.status === 'healthy'
          ? 200
          : health.status === 'degraded'
          ? 200
          : 503;

      return res.status(statusCode).json({
        ...health,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(res, logger, req, 'health-check', error, 503);
    }
  });

  app.get('/api/health/detailed', async (req, res) => {
    try {
      const detailedHealth = await healthService.getDetailedHealth();

      return res.status(200).json({
        ...detailedHealth,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(res, logger, req, 'detailed-health-check', error, 503);
    }
  });

  app.get('/api/health/ready', async (req, res) => {
    try {
      const readiness = await healthService.getReadinessProbe();

      return res.status(readiness.ready ? 200 : 503).json({
        ...readiness,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(res, logger, req, 'readiness-check', error, 503);
    }
  });

  app.get('/api/health/live', async (req, res) => {
    try {
      const liveness = await healthService.getLivenessProbe();

      return res.status(liveness.alive ? 200 : 503).json({
        ...liveness,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(res, logger, req, 'liveness-check', error, 503);
    }
  });
};