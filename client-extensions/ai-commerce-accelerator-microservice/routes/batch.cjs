const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { parseBatchStatuses } = require('../utils/normalize.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

function readSafeQuery(req) {
  const ALLOWED = new Set([
    'sessionId',
    'batchERC',
    'batchExternalReferenceCode',
    'opCode',
    'entity',
    'correlationId',
  ]);
  const SAFE_RE = /^[a-zA-Z0-9._:-]+$/;
  const out = {};
  for (const [k, v] of Object.entries(req.query || {})) {
    if (!ALLOWED.has(k)) continue;
    const str = String(v || '').trim();
    out[k] = SAFE_RE.test(str) ? str : undefined;
  }
  return out;
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
  ws,
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

  try {
    if (ws) {
      ws.emitError({
        correlationId: req.correlationId,
        batchId: meta?.batchId,
        entityType: meta?.entityType || 'system',
        message,
        phase: operation || 'internal',
        errorReference,
        operation,
        details: {
          route: req.originalUrl || req.url,
        },
      });
    }
  } catch (wsErr) {
    logger.warn?.('Failed to emit WS error notification', {
      operation: 'safeErrorResponse-ws-emitError',
      batchId: meta?.batchId,
      correlationId: req.correlationId,
      wsError: wsErr?.message,
    });
  }

  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      error: message,
      errorReference,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = (app, { batchCallbackService, logger, ws }) => {
  app.post(INTERNAL_API_PATHS.BATCH_CALLBACK, async (req, res) => {
    // Return 202 Accepted immediately as per Task 2
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
      // Since we already sent 202, we just log errors here
      logger.error('Failed to enqueue batch callback', {
        batchERC: req.query.batchExternalReferenceCode || req.query.batchERC,
        error: error.message,
      });
    }
  });

  app.get(INTERNAL_API_PATHS.BATCH_STATUS, async (req, res) => {
    const { batchId } = req.params;
    const status = await batchCallbackService.getBatchStatus(batchId);
    res.json({ batchId, ...status });
  });
};
