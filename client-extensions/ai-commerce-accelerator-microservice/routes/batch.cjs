const { parseBatchStatuses } = require('../utils/normalize.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

function readSafeQuery(req) {
  const ALLOWED = new Set(['sessionId', 'batchERC', 'opCode', 'entity']);
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

module.exports = (app, { batchCallbackService }) => {
  app.post('/batch/callback', async (req, res) => {
    // No-op for now to keep Liferay happy
    res.status(200).send();

    try {
      await batchCallbackService.processCallback(req.body, req.query);
    } catch (error) {
      batchCallbackService.handleCallbackError(req, error);
    }
  });

  app.get('/batch/status/:batchId', async (req, res) => {
    const { batchId } = req.params;
    const status = await batchCallbackService.getBatchStatus(batchId);
    res.json({ batchId, ...status });
  });
};