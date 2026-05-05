const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { sanitizeValue } = require('../utils/normalize.cjs');

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

module.exports = (app, { logger, persistenceService, progressService }) => {
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
      const sessions = persistenceService.getCompletedSessions();

      // Return a concise list for the selector modal
      const mapped = sessions.map((s) => ({
        id: s.session_id,
        name: s.session_name,
        date: s.created_at,
        counts: {
          products: s.context?.productCount || 0,
          accounts: s.context?.accountCount || 0,
          orders: s.context?.orderCount || 0,
        },
      }));

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
      const kpis = persistenceService.getWorkflowKPIs();
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

      // Calculate progress per entity type
      const progress = {
        products: { completed: 0, total: 0 },
        accounts: { completed: 0, total: 0 },
        orders: { completed: 0, total: 0 },
        images: { completed: 0, total: 0 },
        pdfs: { completed: 0, total: 0 },
        warehouses: { completed: 0, total: 0 },
        options: { completed: 0, total: 0 },
        specifications: { completed: 0, total: 0 },
      };

      // Consistent mapping with BaseWorkflowService._normalizeEntityType
      const entityMap = {
        'product-data-generation': 'products',
        'create-products': 'products',
        'resolve-product-ids': 'products',
        'create-product-skus': 'products',
        'resolve-sku-ids': 'products',
        'update-inventory': 'products',
        'generate-price-lists': 'products',
        'update-catalog-configuration': 'products',
        'generate-bulk-pricing': 'products',
        'generate-tier-pricing': 'products',
        'delete-products': 'products',
        'delete-product-related': 'products',
        'delete-price-lists': 'products',
        'delete-promotions': 'products',
        'reset-catalog-configuration': 'products',
        deleteproducts: 'products',
        deletepricelists: 'products',
        deletepromotions: 'products',
        resetcatalogconfiguration: 'products',

        'load-countries': 'accounts',
        'generate-account-data': 'accounts',
        'create-accounts': 'accounts',
        'resolve-account-ids': 'accounts',
        'create-postal-addresses': 'accounts',
        'set-address-defaults': 'accounts',
        'delete-accounts': 'accounts',
        deleteaccounts: 'accounts',
        'postal-addresses': 'accounts',
        'set-billing-and-shipping-addresses': 'accounts',

        'generate-order-data': 'orders',
        'create-orders': 'orders',
        'delete-orders': 'orders',
        deleteorders: 'orders',

        'generate-warehouse-data': 'warehouses',
        'create-warehouses': 'warehouses',
        'resolve-warehouse-ids': 'warehouses',
        'delete-warehouses': 'warehouses',
        'delete-warehouse-items': 'warehouses',
        deletewarehouses: 'warehouses',
        deletewarehouseitems: 'warehouses',

        'attach-images': 'images',
        'process-images': 'images',
        'attach-pdfs': 'pdfs',
        'process-pdfs': 'pdfs',

        'link-product-options': 'options',
        'delete-options': 'options',
        'delete-option-categories': 'options',
        'delete-product-options': 'options',
        deleteoptions: 'options',
        deleteproductoptions: 'options',

        'delete-specifications': 'specifications',
        'delete-product-specifications': 'specifications',
        deletespecifications: 'specifications',
      };

      batches.forEach((b) => {
        const entity = entityMap[b.step_key];
        if (entity && progress[entity]) {
          progress[entity].completed += b.processed_count || 0;
          progress[entity].total += b.total_count || 0;
        }
      });

      res.json({
        success: true,
        sessionId,
        status: session.status,
        progress,
        timestamp: new Date().toISOString(),
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

  app.delete(INTERNAL_API_PATHS.WORKFLOW_CLEAR_ALL, async (req, res) => {
    try {
      persistenceService.clearAll();
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

      persistenceService.cleanup(cutoff);

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
