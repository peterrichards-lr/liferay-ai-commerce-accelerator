const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

module.exports = (app, { cacheService, logger }) => {
  app.get(INTERNAL_API_PATHS.EXPORT_COMMERCE_DATA, (req, res) => {
    try {
      const products = cacheService.get('generated-data:products') || [];
      const accounts = cacheService.get('generated-data:accounts') || [];
      const orders = cacheService.get('generated-data:orders') || [];

      const exportData = {
        products,
        accounts,
        orders,
        exportedAt: new Date().toISOString(),
      };

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="commerce-data.json"'
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
