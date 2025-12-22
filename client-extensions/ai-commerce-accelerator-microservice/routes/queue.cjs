const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { queueService } = require('../services/queueService.cjs');
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

function handleError(res, logger, req, operation, error, extra = {}) {
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
    extra,
  });

  return res.status(500).json({
    success: false,
    error: message,
    errorReference,
    timestamp: new Date().toISOString(),
  });
}

module.exports = (app, { logger, queueService }) => {
  app.get(INTERNAL_API_PATHS.QUEUE_STATS, async (req, res) => {
    try {
      const stats = await queueService.getAllStats();

      return res.json({
        success: true,
        stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(res, logger, req, 'queue-stats', error);
    }
  });

  app.get(INTERNAL_API_PATHS.JOBS, async (req, res) => {
    try {
      const job = await queueService.getJob(req.params.jobId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found',
          jobId: req.params.jobId,
          timestamp: new Date().toISOString(),
        });
      }

      return res.json({
        success: true,
        job,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(res, logger, req, 'get-job', error, {
        jobId: req.params.jobId,
      });
    }
  });
};