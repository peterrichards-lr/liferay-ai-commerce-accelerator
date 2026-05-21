const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const multer = require('multer');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');

const S = WORKFLOW_STEPS;
const upload = multer({ storage: multer.memoryStorage() });

module.exports = (
  app,
  {
    logger,
    persistenceService,
    progressService,
    _workflowCoordinator,
    batchCallbackService,
  }
) => {
  app.post(
    INTERNAL_API_PATHS.IMPORT_COMMERCE_DATA,
    upload.single('importFile'),
    async (req, res) => {
      const { config, options: baseOptions } = buildConfigAndOptions(req);
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
        const warehouses = importData.warehouses || [];
        const specificationDefinitions =
          importData.specificationDefinitions || [];
        const optionDefinitions = importData.optionDefinitions || [];

        if (
          products.length === 0 &&
          accounts.length === 0 &&
          orders.length === 0 &&
          warehouses.length === 0
        ) {
          return res.status(400).json({
            success: false,
            error:
              'Invalid import file structure. The file must contain at least one of: products, accounts, orders, or warehouses.',
          });
        }

        logger.info('Starting commerce data import workflow', {
          correlationId,
          operation: 'import-commerce-data',
          productCount: products.length,
          accountCount: accounts.length,
          orderCount: orders.length,
          warehouseCount: warehouses.length,
        });

        const steps = [];
        const productSteps = [];
        const accountSteps = [];
        const orderSteps = [];

        // 1. Warehouse Subflow (Foundation for Products)
        if (warehouses.length > 0) {
          productSteps.push({ name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' });
          productSteps.push({ name: S.CREATE_WAREHOUSES, type: 'sync' });
          productSteps.push({ name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' });
          productSteps.push({ name: S.LINK_WAREHOUSE_CHANNELS, type: 'sync' });
        }

        // 2. Product Subflow
        if (products.length > 0) {
          productSteps.push({ name: S.GENERATE_PRODUCT_DATA, type: 'sync' });
          productSteps.push({
            name: S.ENSURE_SPECIFICATION_CATEGORIES,
            type: 'sync',
          });
          productSteps.push({ name: S.ENSURE_SPECIFICATIONS, type: 'sync' });
          productSteps.push({ name: S.ENSURE_OPTIONS, type: 'sync' });
          productSteps.push({ name: S.CREATE_PRODUCTS, type: 'sync' });
          productSteps.push({ name: S.RESOLVE_PRODUCT_IDS, type: 'sync' });
          productSteps.push({ name: S.LINK_PRODUCT_OPTIONS, type: 'sync' });
          productSteps.push({ name: S.CREATE_PRODUCT_SKUS, type: 'sync' });
          productSteps.push({ name: S.RESOLVE_SKU_IDS, type: 'sync' });
          productSteps.push({ name: S.SYNC_DELAY_PRICING, type: 'sync' });
          productSteps.push({ name: S.GENERATE_PRICE_LISTS, type: 'sync' });
          productSteps.push({ name: S.UPDATE_CATALOG_CONFIG, type: 'sync' });
          productSteps.push({ name: S.UPDATE_INVENTORY, type: 'sync' });
        }

        // 3. Account Subflow
        if (accounts.length > 0) {
          accountSteps.push({ name: S.LOAD_COUNTRIES, type: 'sync' });
          accountSteps.push({ name: S.GENERATE_ACCOUNT_DATA, type: 'sync' });
          accountSteps.push({ name: S.CREATE_ACCOUNTS, type: 'sync' });
          accountSteps.push({ name: S.RESOLVE_ACCOUNT_IDS, type: 'sync' });
          accountSteps.push({ name: S.CREATE_POSTAL_ADDRESSES, type: 'sync' });
          accountSteps.push({ name: S.SET_ADDRESS_DEFAULTS, type: 'sync' });
        }

        // 4. Order Subflow
        if (orders.length > 0) {
          orderSteps.push({ name: S.SYNC_DELAY_ORDERS, type: 'sync' });
          orderSteps.push({ name: S.GENERATE_ORDER_DATA, type: 'sync' });
          orderSteps.push({ name: S.CREATE_ORDERS, type: 'sync' });
        }

        // COMPOSE WORKFLOW
        if (productSteps.length > 0 || accountSteps.length > 0) {
          steps.push({
            type: 'parallel',
            steps: [
              ...(productSteps.length > 0
                ? [
                    {
                      name: 'subflow-products',
                      type: 'sequence',
                      steps: productSteps,
                    },
                  ]
                : []),
              ...(accountSteps.length > 0
                ? [
                    {
                      name: 'subflow-accounts',
                      type: 'sequence',
                      steps: accountSteps,
                    },
                  ]
                : []),
            ],
          });
        }

        if (orderSteps.length > 0) {
          steps.push({
            name: 'subflow-orders',
            type: 'sequence',
            steps: orderSteps,
          });
        }

        const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

        // Map data to context keys that generators expect
        const context = {
          config,
          options: {
            ...baseOptions,
            importMode: true,
            productCount: products.length,
            accountCount: accounts.length,
            orderCount: orders.length,
            warehouseCount: warehouses.length,
          },
          steps,
          generator: 'unified',
          productDataList: products,
          accountDataList: accounts,
          orderDataList: orders,
          warehouseDataList: warehouses,
          // Foundations
          specificationDefinitions,
          optionDefinitions,
        };

        await persistenceService.createSession({
          sessionId,
          flowType: 'import',
          status: 'STARTED',
          currentSteps: [],
          correlationId,
          sessionName:
            baseOptions.sessionName ||
            `Import ${new Date().toLocaleDateString()}`,
          context,
        });

        progressService.sessionStarted({
          sessionId,
          flowType: 'import',
          correlationId,
        });

        batchCallbackService._checkSessionCompletion(sessionId, correlationId);

        return res.json({
          success: true,
          sessionId,
          message: 'Commerce data import workflow started.',
          correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const errorReference = createERC(ERC_PREFIX.ERROR);
        logger.error('Failed to initialize commerce data import', {
          operation: 'import-commerce-data',
          errorReference,
          message: error.message,
          stack: error.stack,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to initialize commerce data import',
          errorReference,
        });
      }
    }
  );
};
