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

module.exports = (app, { logger, persistenceService }) => {
  app.get(INTERNAL_API_PATHS.WORKFLOW_SESSIONS, async (req, res) => {
    try {
      const sessions = await persistenceService.getAllSessions();
      res.json({
        success: true,
        sessions,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-sessions',
        meta: {},
        statusCode: 500,
        fallbackMessage: 'Failed to get workflow sessions',
      });
    }
  });

  app.get(INTERNAL_API_PATHS.WORKFLOW_BATCHES, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const batches = await persistenceService.getBatchesForSession(sessionId);
      res.json({
        success: true,
        batches,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-batches',
        meta: { sessionId: req.params.sessionId },
        statusCode: 500,
        fallbackMessage: 'Failed to get workflow batches',
      });
    }
  });

  app.get(INTERNAL_API_PATHS.WORKFLOW_SUMMARY, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await persistenceService.getSession(sessionId);
      if (!session) {
        return res
          .status(404)
          .json({ success: false, error: 'Session not found' });
      }

      const batches = await persistenceService.getBatchesForSession(sessionId);
      const events = await persistenceService.getEventsForSession(sessionId);

      const stepMap = new Map();

      events.forEach((event) => {
        if (event.status === 'STEP_STARTED') {
          const stepName =
            event.details?.step || event.message.match(/'([^']+)'/)?.[1];
          if (stepName) {
            stepMap.set(stepName, {
              name: stepName,
              startedAt: event.timestamp,
              status: 'RUNNING',
            });
          }
        } else if (
          event.status === 'STEP_COMPLETED' ||
          event.status === 'STEP_FAILED'
        ) {
          const stepName =
            event.details?.step || event.message.match(/'([^']+)'/)?.[1];
          const step = stepMap.get(stepName);
          if (step) {
            step.completedAt = event.timestamp;
            step.status =
              event.status === 'STEP_COMPLETED' ? 'COMPLETED' : 'FAILED';
            step.durationMs =
              new Date(step.completedAt) - new Date(step.startedAt);
          }
        }
      });

      const summary = {
        sessionId,
        flowType: session.flow_type,
        status: session.status,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        durationMs: new Date(session.updated_at) - new Date(session.created_at),
        steps: Array.from(stepMap.values()),
        batchCount: batches.length,
        eventCount: events.length,
        batches: batches.map((b) => ({
          erc: b.erc,
          stepKey: b.step_key,
          status: b.status,
          processedCount: b.processed_count,
          totalCount: b.total_count,
          errorCount: b.error_count,
        })),
      };

      res.json({
        success: true,
        summary,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-summary',
        meta: { sessionId: req.params.sessionId },
        statusCode: 500,
        fallbackMessage: 'Failed to get workflow summary',
      });
    }
  });
};
