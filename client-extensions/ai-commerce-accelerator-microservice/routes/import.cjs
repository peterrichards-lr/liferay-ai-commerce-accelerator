const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const multer = require('multer');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');

const upload = multer({ storage: multer.memoryStorage() });

module.exports = (app, { liferayService, logger, configService }) => {
  app.post(
    INTERNAL_API_PATHS.IMPORT_COMMERCE_DATA,
    upload.single('importFile'),
    async (req, res) => {
      const { config } = buildConfigAndOptions(req);
      const correlationId = config.correlationId;

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: 'No file uploaded' });
      }

      try {
        const importData = JSON.parse(req.file.buffer.toString());

        const products = importData.products || [];
        const accounts = importData.accounts || [];
        const orders = importData.orders || [];

        if (products.length === 0 && accounts.length === 0 && orders.length === 0) {
          return res.status(400).json({
            success: false,
            error:
              'Invalid import file structure. The file must contain at least one of: products, accounts, or orders.',
          });
        }

        logger.info('Starting commerce data import', {
          correlationId,
          operation: 'import-commerce-data',
          productCount: products.length,
          accountCount: accounts.length,
          orderCount: orders.length,
        });

        const batchIds = [];

        if (products && products.length > 0) {
          const result = await liferayService.createProductsBatch(
            config,
            products
          );
          batchIds.push(result.batchId);
          logger.info(`Products import batch created: ${result.batchId}`);
        }

        if (accounts && accounts.length > 0) {
          const result = await liferayService.createAccountsBatch(
            config,
            accounts
          );
          batchIds.push(result.batchId);
          logger.info(`Accounts import batch created: ${result.batchId}`);
        }

        if (orders && orders.length > 0) {
          const result = await liferayService.createOrdersBatch(config, orders);
          batchIds.push(result.batchId);
          logger.info(`Orders import batch created: ${result.batchId}`);
        }

        res.status(202).json({
          success: true,
          message: 'Commerce data import started.',
          batchIds,
        });
      } catch (error) {
        const errorReference = createERC(ERC_PREFIX.ERROR);
        logger.error('Failed to import commerce data', {
          operation: 'import-commerce-data',
          errorReference,
          message: error.message,
          stack: error.stack,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to import commerce data',
          errorReference,
        });
      }
    }
  );
};
