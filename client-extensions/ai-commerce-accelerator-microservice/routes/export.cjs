const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

module.exports = (app, { cacheService, logger, persistenceService }) => {
  app.get(INTERNAL_API_PATHS.EXPORT_COMMERCE_DATA, async (req, res) => {
    try {
      const { sessionId } = req.query;
      let exportData = null;

      if (sessionId) {
        const session = await persistenceService.getSession(sessionId);
        if (session && session.context) {
          const ctx = session.context;
          exportData = {
            metadata: {
              source: 'session-db',
              sessionId: session.session_id,
              sessionName: session.session_name,
              completedAt: session.updated_at,
            },
            products: ctx.productDataList || [],
            accounts: ctx.accountDataList || [],
            orders: ctx.orderDataList || [],
            addresses: ctx.addressesToCreate || [],
            warehouses: ctx.warehouseDataList || [],
            specificationDefinitions: ctx.specificationDefinitions || [],
            optionDefinitions: ctx.optionDefinitions || [],
            defaultSpecificationCategory:
              ctx.defaultSpecificationCategory || null,
            images: ctx.createdImages || [],
            pdfs: ctx.createdPdfs || [],
            groundingMetadata: ctx.groundingMetadata || null,
            exportedAt: new Date().toISOString(),
          };
        }
      }

      // Fallback to cache if no sessionId or session not found
      if (!exportData) {
        const products = cacheService.get('generated-data:products');
        const accounts = cacheService.get('generated-data:accounts');
        const orders = cacheService.get('generated-data:orders');

        if (products || accounts || orders) {
          exportData = {
            metadata: { source: 'cache' },
            products: products || [],
            accounts: accounts || [],
            orders: orders || [],
            exportedAt: new Date().toISOString(),
          };
        }
      }

      // Final fallback to latest completed in DB
      if (!exportData) {
        const latestSession =
          await persistenceService.getLatestCompletedSession();
        if (latestSession && latestSession.context) {
          const ctx = latestSession.context;
          exportData = {
            metadata: {
              source: 'session-db-latest',
              sessionId: latestSession.session_id,
              sessionName: latestSession.session_name,
              completedAt: latestSession.updated_at,
            },
            products: ctx.productDataList || [],
            accounts: ctx.accountDataList || [],
            orders: ctx.orderDataList || [],
            addresses: ctx.addressesToCreate || [],
            warehouses: ctx.warehouseDataList || [],
            specificationDefinitions: ctx.specificationDefinitions || [],
            optionDefinitions: ctx.optionDefinitions || [],
            defaultSpecificationCategory:
              ctx.defaultSpecificationCategory || null,
            images: ctx.createdImages || [],
            pdfs: ctx.createdPdfs || [],
            groundingMetadata: ctx.groundingMetadata || null,
            exportedAt: new Date().toISOString(),
          };
        }
      }

      if (!exportData) {
        exportData = {
          metadata: { source: 'empty' },
          products: [],
          accounts: [],
          orders: [],
          exportedAt: new Date().toISOString(),
        };
      }

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
