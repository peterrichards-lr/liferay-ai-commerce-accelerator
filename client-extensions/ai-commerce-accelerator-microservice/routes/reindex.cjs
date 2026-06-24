const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

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
      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
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
      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
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
