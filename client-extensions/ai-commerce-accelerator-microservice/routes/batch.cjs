const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

module.exports = (app, { batchCallbackService, logger }) => {
  app.post(INTERNAL_API_PATHS.BATCH_CALLBACK, async (req, res) => {
    // Return 202 Accepted immediately
    res.status(202).send();

    try {
      const batchERC =
        req.query.batchExternalReferenceCode || req.query.batchERC;
      const correlationId = req.query.correlationId;
      const sessionId = req.query.sessionId;

      // This now enqueues the job instead of processing immediately
      await batchCallbackService.processCallback(
        batchERC,
        req.body,
        correlationId,
        sessionId
      );
    } catch (error) {
      const errorReference =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      logger.error('Unhandled error in batch callback processing:', {
        message: error.message,
        batchERC: req.query.batchExternalReferenceCode || req.query.batchERC,
        correlationId: req.query.correlationId,
        errorReference,
      });
    }
  });

  app.get(INTERNAL_API_PATHS.BATCH_CALLBACK, (req, res) => {
    res.status(405).json({
      success: false,
      error: 'Method Not Allowed. Use POST for batch callbacks.',
    });
  });
};
