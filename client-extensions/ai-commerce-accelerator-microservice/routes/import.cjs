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
    liferayService,
  }
) => {
  app.post(
    INTERNAL_API_PATHS.IMPORT_COMMERCE_DATA,
    upload.single('importFile'),
    async (req, res) => {
      const { config, options: baseOptions } = buildConfigAndOptions(req);
      const correlationId = config.correlationId;

      // Robust fallback: resolve missing channelId/siteGroupId and catalogId at backend API handler level
      if (
        !config.channelId ||
        isNaN(config.channelId) ||
        !config.siteGroupId ||
        isNaN(config.siteGroupId)
      ) {
        try {
          const channels = await liferayService.getChannels(config);
          if (channels && channels.length > 0) {
            let matchedChannel = null;
            if (config.channelId && !isNaN(config.channelId)) {
              matchedChannel = channels.find(
                (c) => Number(c.id) === Number(config.channelId)
              );
            }
            if (!matchedChannel) {
              matchedChannel = channels[0];
            }
            if (!config.channelId || isNaN(config.channelId)) {
              config.channelId = parseInt(matchedChannel.id, 10);
            }
            if (!config.siteGroupId || isNaN(config.siteGroupId)) {
              config.siteGroupId = parseInt(matchedChannel.siteGroupId, 10);
            }
            logger.info(
              `Resolved fallback commerce channelId: ${config.channelId}, siteGroupId: ${config.siteGroupId}`
            );
          } else {
            logger.warn(
              'No channels found in Liferay to resolve fallback channelId/siteGroupId'
            );
          }
        } catch (err) {
          logger.error(
            'Failed to resolve fallback channelId/siteGroupId from Liferay',
            { error: err.message }
          );
        }
      }

      if (!config.catalogId || isNaN(config.catalogId)) {
        try {
          const catalogs = await liferayService.getCatalogs(config);
          if (catalogs && catalogs.length > 0) {
            config.catalogId = parseInt(catalogs[0].id, 10);
            logger.info(
              `Resolved fallback commerce catalogId: ${config.catalogId}`
            );
          } else {
            logger.warn(
              'No catalogs found in Liferay to resolve fallback catalogId'
            );
          }
        } catch (err) {
          logger.error('Failed to resolve fallback catalogId from Liferay', {
            error: err.message,
          });
        }
      }

      let importData;

      try {
        if (!req.file) {
          if (req.body && req.body.dataset) {
            importData =
              typeof req.body.dataset === 'string'
                ? JSON.parse(req.body.dataset)
                : req.body.dataset;
          } else {
            return res
              .status(400)
              .json({ success: false, error: 'No file uploaded' });
          }
        } else {
          importData = JSON.parse(req.file.buffer.toString());
        }
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: `Invalid JSON dataset: ${e.message}`,
        });
      }

      try {
        const products = importData.products || [];
        const accounts = importData.accounts || [];
        const orders = importData.orders || [];
        const warehouses = importData.warehouses || [];
        const addresses = importData.addresses || [];
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
            generatePriceLists: true,
            generateSkuVariants: true,
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
          addressesToCreate: addresses,
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
