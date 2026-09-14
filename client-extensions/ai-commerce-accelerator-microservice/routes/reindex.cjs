const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const {
  ENDPOINT_MISSING,
  SCOPE_DENIED,
  recordReindexFailure,
  recordReindexSuccess,
} = require('../utils/reindexStatus.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const { writeTargetSchema } = require('../utils/schemas.cjs');

// classifyReindexError (utils/reindexStatus.cjs) already worked out which of
// these happened; the only job left here is picking a status that does not
// mislead the caller. ENDPOINT_MISSING is unambiguously this deployment's own
// gap, hence 503. SCOPE_DENIED is refused at Liferay's OAuth gate using the
// grant this microservice's own OAuth client presents - nothing the caller of
// POST /reindex supplied - so a 4xx would send an operator hunting through
// their own request when the missing grant is in client-extension.yaml. 502
// keeps it in the same "something between us and Liferay is wrong" family as
// 503 without claiming the module itself is undeployed. Anything left
// unclassified keeps the pre-existing 500. See #960.
const STATUS_BY_REINDEX_STATE = {
  [ENDPOINT_MISSING]: 503,
  [SCOPE_DENIED]: 502,
};

// Both routes below hit the same failure path with only the operation label
// differing, and #960 was exactly this logic being duplicated once per route
// and only kept in sync in one of the two copies.
function respondToReindexFailure(res, logger, config, operation, error) {
  const outcome = recordReindexFailure(error);
  const status = STATUS_BY_REINDEX_STATE[outcome.state] ?? 500;
  const errorRef = resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

  logger.error('Operation failed', {
    correlationId: config?.correlationId,
    errorReference: errorRef,
    operation,
    message: outcome.message,
  });

  // outcome.message is the same text reindexHealth() reports for this same
  // failure - a caller reading the response body and an operator polling
  // /health must not be told two different stories about one call. See #960.
  return res.status(status).json({
    success: false,
    error: outcome.message,
    errorReference: errorRef,
    timestamp: new Date().toISOString(),
  });
}

module.exports = (app, { logger, liferayService, configService }) => {
  // A reindex is a write against a named instance's search engine, and #815
  // showed the target being inferred. The best-effort reindex that follows a
  // workflow does not come through here - it calls liferayService with the
  // run's own config - so requiring the target costs that path nothing.
  app.post(
    INTERNAL_API_PATHS.REINDEX,
    inputValidationMiddleware(writeTargetSchema),
    async (req, res) => {
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
        return respondToReindexFailure(
          res,
          logger,
          config,
          'trigger-reindex-all',
          error
        );
      }
    }
  );

  // Same reasoning as the reindex-all route above. See #815.
  app.post(
    INTERNAL_API_PATHS.REINDEX_CLASS,
    inputValidationMiddleware(writeTargetSchema),
    async (req, res) => {
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
        return respondToReindexFailure(
          res,
          logger,
          config,
          'trigger-reindex-class',
          error
        );
      }
    }
  );
};
