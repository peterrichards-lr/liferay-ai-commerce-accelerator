const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { sweepOrphanMediaArchives } = require('../utils/mediaArchive.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { sanitizeValue } = require('../utils/normalize.cjs');
const {
  MEDIA_SCOPES,
  selectProductsForMedia,
} = require('../utils/mediaScope.cjs');

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

/**
 * Step to progress-bucket mapping, mirroring the SDK's
 * `BaseWorkflowService._normalizeEntityType`. Lifted to module scope so the
 * two can be compared by a test rather than by a comment: the copies had
 * already drifted, and `reset-catalog-config` kept counting against products
 * here after the SDK stopped (#841).
 */
const STEP_ENTITY_MAP = {
  // Only map primary creation/deletion steps to avoid inflating totals
  'create-products': 'products',
  'delete-products': 'products',
  'create-skus': 'skus',
  'create-accounts': 'accounts',
  'delete-accounts': 'accounts',
  'create-orders': 'orders',
  'delete-orders': 'orders',
  'create-warehouses': 'warehouses',
  'delete-warehouses': 'warehouses',
  'create-price-lists': 'priceLists',
  'delete-price-lists': 'priceLists',
  'create-bulk-pricing': 'priceLists',
  'create-tier-pricing': 'priceLists',
  'delete-promotions': 'promotions',
  'create-images': 'images',
  'create-pdfs': 'pdfs',
  'create-addresses': 'addresses',
  'delete-options': 'options',
  'delete-specifications': 'specifications',
  // Not products. The step deletes nothing and reports the one unit
  // it processed, so counting it here made a delete run show
  // "Products 1 Deleted, Done" while delete-products was still
  // PREPARED at 0 of 50, and the bar stayed finished for the rest of
  // the run (#786). `progress` has no `config` key and the accumulator
  // guards on one, so the step now counts against nothing - which is
  // what it did. Mirrors the SDK's _normalizeEntityType (SDK #182).
  'reset-catalog-config': 'config',
};

/**
 * What a run asked for, before any of it has happened.
 *
 * A bar that reads 0/0 until the first batch lands tells an operator nothing,
 * so each bucket starts at the figure the request implies and the run's own
 * batches raise it from there.
 */
function requestedTotals(options) {
  const count = (value) => Number.parseInt(value, 10) || 0;
  const mediaTotal = (mode, ratio) =>
    mode !== 'none'
      ? Math.round((count(options.productCount) * (ratio || 0)) / 100)
      : 0;

  return {
    products: count(options.productCount),
    skus: 0,
    accounts: count(options.accountCount),
    orders: count(options.orderCount),
    priceLists: 0,
    promotions: 0,
    images: mediaTotal(options.imageMode, options.imageRatio),
    pdfs: mediaTotal(options.pdfMode, options.pdfRatio),
    warehouses: options.createWarehouses ? count(options.warehouseCount) : 0,
    options: 0,
    specifications: 0,
    addresses: 0,
  };
}

/**
 * Per-entity `completed` and `total`, both read from the same batch rows.
 *
 * The two numbers used to be gathered differently: `completed` summed every
 * batch in the bucket while `total` took the largest single one. Any step that
 * submits more than one batch therefore counted all of its work against the
 * size of one batch, and any bucket fed by more than one step did it again.
 * A run that created 47 standard and 10 promotional price entries in four
 * batches reported `57/47`, and one SKU batch per product reported `7/1` -
 * counters that exceed their own total, on a run where every entity was
 * correct (#891).
 *
 * `total_count` is what the step said it was about to attempt and
 * `processed_count` what it achieved, so summing both over the same rows is
 * the only pairing that can be read as a fraction. Steps fan out - a product
 * yields several price entries - and the sum is what makes the denominator
 * reflect that rather than the input count.
 *
 * The requested figure stays a floor rather than being replaced, mirroring the
 * dashboard's `withRequestFloor`: 16 products delivered against 50 asked for
 * is 16/50, not 16/16 (#756).
 */
function summariseSessionProgress({ batches = [], options = {} }) {
  const counters = new Map(
    Object.entries(requestedTotals(options)).map(([entity, total]) => [
      entity,
      { completed: 0, requested: total, total },
    ])
  );

  batches.forEach((batch) => {
    const counter = counters.get(STEP_ENTITY_MAP[batch.step_key]);

    // A step mapped to no bucket declines to be counted, which is how
    // reset-catalog-config stopped reporting against products (#786).
    if (!counter) return;

    counter.completed += batch.processed_count || 0;
    counter.attempted = (counter.attempted || 0) + (batch.total_count || 0);
    counter.total = Math.max(counter.requested, counter.attempted);
  });

  return Object.fromEntries(
    [...counters].map(([entity, { completed, total }]) => [
      entity,
      { completed, total },
    ])
  );
}

module.exports = (app, { logger, persistenceService, progressService }) => {
  /**
   * Media whose session no longer exists, removed.
   *
   * Read back rather than tracked: the two routes below remove sessions in
   * bulk and report counts, not identities, so what survives is the only
   * reliable answer to what should keep its media. A failure here leaves
   * directories for the next sweep and must not fail the request that asked
   * for the sessions to go - they already have.
   */
  const sweepMediaForSurvivingSessions = async () => {
    try {
      const sessions = await persistenceService.getAllSessions();

      sweepOrphanMediaArchives({
        knownSessionIds: sessions.map((session) => session.session_id),
        logger,
      });
    } catch (error) {
      logger.warn(
        `Could not sweep orphaned media after clearing sessions: ${error.message}. The directories stay until the next sweep.`
      );
    }
  };

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

  app.get(INTERNAL_API_PATHS.COMPLETED_WORKFLOW_SESSIONS, async (req, res) => {
    try {
      const sessions = await persistenceService.getCompletedSessions();

      // Return a concise list for the selector modals
      const mapped = sessions.map((s) => {
        const context = s.context || {};
        const options = context.options || {};
        const missing = selectProductsForMedia(context, {
          scope: MEDIA_SCOPES.MISSING,
        });

        return {
          id: s.session_id,
          name: s.session_name,
          date: s.created_at,
          flowType: s.flow_type,
          counts: {
            products:
              context.productDataList?.length || options.productCount || 0,
            accounts:
              context.accountDataList?.length || options.accountCount || 0,
            orders: context.orderDataList?.length || options.orderCount || 0,
          },
          media: {
            missingImages: missing.imageProducts.length,
            missingPdfs: missing.pdfProducts.length,
          },
        };
      });

      res.json({ success: true, sessions: mapped });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'get-completed-workflow-sessions',
        statusCode: 500,
        fallbackMessage: 'Failed to retrieve completed workflow sessions',
      });
    }
  });

  app.get(INTERNAL_API_PATHS.WORKFLOW_KPIS, async (req, res) => {
    try {
      const kpis = await persistenceService.getWorkflowKPIs();
      res.json({ success: true, kpis });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'get-workflow-kpis',
        statusCode: 500,
        fallbackMessage: 'Failed to retrieve workflow KPIs',
      });
    }
  });

  app.get(INTERNAL_API_PATHS.WORKFLOW_CANCEL, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const success = await persistenceService.tryCancelSession(sessionId);

      if (success) {
        // Broadcase cancellation event
        await progressService.sessionFailed({
          sessionId,
          correlationId: req.correlationId,
          error: { message: 'Workflow cancelled by user.' },
        });

        res.json({
          success: true,
          message: 'Workflow cancellation requested.',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Session not found or already terminal.',
        });
      }
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-cancel',
        statusCode: 500,
        fallbackMessage: 'Failed to cancel workflow session',
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

  app.get(INTERNAL_API_PATHS.WORKFLOW_SESSION_CONTEXT, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await persistenceService.getSession(sessionId);

      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
          timestamp: new Date().toISOString(),
        });
      }

      // Redact sensitive information from the context
      const redactedContext = sanitizeValue(session.context, [
        'workflow-context',
      ]);

      res.json({
        success: true,
        sessionId,
        context: redactedContext,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-session-context',
        meta: { sessionId: req.params.sessionId },
        statusCode: 500,
        fallbackMessage: 'Failed to get workflow session context',
      });
    }
  });

  app.get(INTERNAL_API_PATHS.WORKFLOW_STATUS, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await persistenceService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
          timestamp: new Date().toISOString(),
        });
      }

      const batches = await persistenceService.getBatchesForSession(sessionId);

      const { options = {} } = session.context || {};

      const progress = summariseSessionProgress({ batches, options });

      const totalSteps = session.context?.steps?.length || 0;
      const completedSteps = session.currentSteps?.length || 0;

      let overallProgress = 0;
      if (session.status === 'COMPLETED') {
        overallProgress = 100;
      } else {
        const totalItems = Object.values(progress).reduce(
          (acc, curr) => acc + (curr.total || 0),
          0
        );
        const completedItems = Object.values(progress).reduce(
          (acc, curr) => acc + (curr.completed || 0),
          0
        );
        overallProgress =
          totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
      }

      const activeStepKey =
        session.status === 'COMPLETED'
          ? 'completed'
          : session.currentSteps?.[session.currentSteps.length - 1] ||
            'polling';

      res.json({
        success: true,
        sessionId,
        status: session.status,
        flowType: session.flow_type,
        totalSteps,
        completedSteps,
        progress,
        timestamp: new Date().toISOString(),
        session: {
          status: session.status,
          overall_progress: overallProgress,
          active_step_key: activeStepKey,
          completed_products_count: progress.products?.completed || 0,
          target_products_count: progress.products?.total || 0,
        },
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-status',
        meta: { sessionId: req.params.sessionId },
        statusCode: 500,
        fallbackMessage: 'Failed to get workflow status',
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

  app.get(INTERNAL_API_PATHS.WORKFLOW_EVENTS, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const events = await persistenceService.getEventsForSession(sessionId);
      res.json({
        success: true,
        sessionId,
        events,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-events',
        meta: { sessionId: req.params.sessionId },
        statusCode: 500,
        fallbackMessage: 'Failed to get workflow events',
      });
    }
  });

  app.delete(INTERNAL_API_PATHS.WORKFLOW_CLEAR_ALL, async (req, res) => {
    try {
      await persistenceService.clearAll();
      // The sessions are gone; their media would otherwise stay until the age
      // prune got to it, on the one path where someone has explicitly asked
      // for everything to go (#898).
      await sweepMediaForSurvivingSessions();
      res.json({
        success: true,
        message: 'All workflow data cleared successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-clear-all',
        meta: {},
        statusCode: 500,
        fallbackMessage: 'Failed to clear workflow data',
      });
    }
  });

  app.delete(INTERNAL_API_PATHS.WORKFLOW_CLEANUP, async (req, res) => {
    try {
      let { cutoff } = req.query;

      if (!cutoff) {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        cutoff = midnight.toISOString();
      }

      await persistenceService.cleanup(cutoff);
      await sweepMediaForSurvivingSessions();

      res.json({
        success: true,
        message: `Workflow data created before ${cutoff} cleared successfully`,
        cutoff,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'workflow-cleanup',
        meta: { cutoff: req.query.cutoff },
        statusCode: 500,
        fallbackMessage: 'Failed to cleanup workflow data',
      });
    }
  });
};

module.exports.STEP_ENTITY_MAP = STEP_ENTITY_MAP;
module.exports.summariseSessionProgress = summariseSessionProgress;
