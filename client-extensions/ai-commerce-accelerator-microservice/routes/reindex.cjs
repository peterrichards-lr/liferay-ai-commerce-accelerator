const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const {
  ENDPOINT_MISSING,
  recordReindexFailure,
  recordReindexSuccess,
} = require('../utils/reindexStatus.cjs');

function handleError(res, logger, req, config, operation, error) {
  const errorRef = resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
  const errorMessage = error?.message || 'Failed to trigger search reindexing';

  logger.error('Operation failed', {
    correlationId: config?.correlationId,
    errorReference: errorRef,
    operation,
    message: errorMessage,
  });

  return res.status(500).json({
    success: false,
    error: errorMessage,
    errorReference: errorRef,
  });
}

module.exports = (app, { logger, liferayService, configService }) => {
  app.post(INTERNAL_API_PATHS.REINDEX, async (req, res) => {
    let config;
    try {
      ({ config } = await buildConfigAndOptions(req, configService));
      const result = await liferayService.rest.triggerReindex(config);
      recordReindexSuccess();

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      // An explicit reindex already reports its own failure, unlike the
      // best-effort calls after a workflow - but recording it keeps /health
      // accurate whichever path triggered it, and a 404 deserves better than
      // "Request failed with status code 404". See #618.
      const outcome = recordReindexFailure(error);

      if (outcome.state === ENDPOINT_MISSING) {
        return res.status(503).json({
          success: false,
          error: outcome.message,
          timestamp: new Date().toISOString(),
        });
      }

      return handleError(
        res,
        logger,
        req,
        config,
        'trigger-reindex-all',
        error
      );
    }
  });

  app.post(INTERNAL_API_PATHS.REINDEX_CLASS, async (req, res) => {
    let config;
    const { className } = req.params;
    try {
      ({ config } = await buildConfigAndOptions(req, configService));
      const result = await liferayService.rest.triggerReindex(
        config,
        className
      );
      recordReindexSuccess();

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      // An explicit reindex already reports its own failure, unlike the
      // best-effort calls after a workflow - but recording it keeps /health
      // accurate whichever path triggered it, and a 404 deserves better than
      // "Request failed with status code 404". See #618.
      const outcome = recordReindexFailure(error);

      if (outcome.state === ENDPOINT_MISSING) {
        return res.status(503).json({
          success: false,
          error: outcome.message,
          timestamp: new Date().toISOString(),
        });
      }

      return handleError(
        res,
        logger,
        req,
        config,
        'trigger-reindex-class',
        error
      );
    }
  });
};
