const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

module.exports = (app, { cacheService, logger, persistenceService }) => {
  app.get(INTERNAL_API_PATHS.EXPORT_COMMERCE_DATA, (req, res) => {
    try {
      const { sessionId } = req.query;
      let products, accounts, orders;
      let metadata = {};

      if (sessionId) {
        const session = persistenceService.getSession(sessionId);
        if (session && session.context) {
          products = session.context.productDataList;
          accounts = session.context.accountDataList;
          orders = session.context.orderDataList;
          metadata = {
            source: 'session-db',
            sessionId: session.session_id,
            sessionName: session.session_name,
            completedAt: session.updated_at,
          };
        }
      }

      // Fallback to cache if no sessionId or session not found
      if (!products && !accounts && !orders) {
        products = cacheService.get('generated-data:products');
        accounts = cacheService.get('generated-data:accounts');
        orders = cacheService.get('generated-data:orders');
        metadata = { source: 'cache' };
      }

      // Final fallback to latest completed in DB
      if (!products && !accounts && !orders) {
        const latestSession = persistenceService.getLatestCompletedSession();
        if (latestSession && latestSession.context) {
          products = latestSession.context.productDataList;
          accounts = latestSession.context.accountDataList;
          orders = latestSession.context.orderDataList;
          metadata = {
            source: 'session-db-latest',
            sessionId: latestSession.session_id,
            sessionName: latestSession.session_name,
            completedAt: latestSession.updated_at,
          };
        }
      }

      const exportData = {
        metadata,
        products: products || [],
        accounts: accounts || [],
        orders: orders || [],
        exportedAt: new Date().toISOString(),
      };

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="commerce-dataset.json"'
      );
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(exportData);
    } catch (error) {
      const errorReference = createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to export commerce data', {
        operation: 'export-commerce-data',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to export commerce data',
        errorReference,
      });
    }
  });
};
