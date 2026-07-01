const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const multer = require('multer');
const {
  buildConfigAndOptions,
  sanitizedObject,
} = require('../utils/normalize.cjs');
const { handleError } = require('../utils/handleErrorHelper.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');
const { resolveErrorReference, createERC } = require('../utils/misc.cjs');

const S = WORKFLOW_STEPS;

const upload = multer({ storage: multer.memoryStorage() });

function emitRouteError(
  progress,
  { error, operation, entityType, correlationId, errorReference }
) {
  if (progress?.emitError) {
    progress.emitError({
      message: error.message || 'Workflow initialization failed',
      operation,
      entityType,
      correlationId,
      errorReference,
    });
  }
}

module.exports = (
  app,
  {
    liferayService,
    logger,
    progressService,
    persistenceService,
    batchCallbackService,
    configService,
  }
) => {
  app.post(
    INTERNAL_API_PATHS.GENERATE_WORKFLOW,
    upload.fields([{ name: 'customImageFile' }, { name: 'customPDFFile' }]),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);
      config.demoMode = options.demoMode;

      // Check if OpenAI key is available, if not fallback to seed pack!
      let openAiKeyAvailable = false;
      try {
        const aiCfg = await configService.getAIConfig(config);
        openAiKeyAvailable = !!(
          aiCfg?.apiKey ||
          aiCfg?.openAiKey ||
          process.env.OPENAI_API_KEY
        );
      } catch (err) {
        logger.warn(
          'Failed to verify OpenAI key availability via configService',
          { error: err.message }
        );
      }

      if (!options.demoMode && !openAiKeyAvailable) {
        logger.warn(
          'OpenAI key is not configured or unavailable. Automatically falling back to "industrial-power-tools" seed pack.'
        );
        options.seedPack = 'industrial-power-tools';
        options.demoMode = true;
      }

      if (options.seedPack) {
        const fs = require('fs');
        const path = require('path');
        const seedPackPath = path.join(
          __dirname,
          `../resources/seed-packs/${options.seedPack}.json`
        );
        if (!fs.existsSync(seedPackPath)) {
          return res.status(400).json({
            success: false,
            error: `Seed pack not found: ${options.seedPack}`,
          });
        }
        const seedData = JSON.parse(fs.readFileSync(seedPackPath, 'utf8'));
        const products = seedData.products || [];
        const accounts = seedData.accounts || [];
        const orders = seedData.orders || [];
        const warehouses = seedData.warehouses || [];
        const addresses = seedData.addresses || [];
        const specificationDefinitions =
          seedData.specificationDefinitions || [];
        const optionDefinitions = seedData.optionDefinitions || [];

        const steps = [];
        const productSteps = [];
        const accountSteps = [];
        const orderSteps = [];

        if (warehouses.length > 0) {
          productSteps.push({ name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' });
          productSteps.push({ name: S.CREATE_WAREHOUSES, type: 'sync' });
          productSteps.push({ name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' });
          productSteps.push({ name: S.LINK_WAREHOUSE_CHANNELS, type: 'sync' });
        }

        if (products.length > 0) {
          productSteps.push({ name: S.GENERATE_PRODUCT_DATA, type: 'sync' });
          productSteps.push({ name: S.ENSURE_CATEGORIES, type: 'sync' });
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

        if (accounts.length > 0) {
          accountSteps.push({ name: S.LOAD_COUNTRIES, type: 'sync' });
          accountSteps.push({ name: S.GENERATE_ACCOUNT_DATA, type: 'sync' });
          accountSteps.push({ name: S.CREATE_ACCOUNTS, type: 'sync' });
          accountSteps.push({ name: S.RESOLVE_ACCOUNT_IDS, type: 'sync' });
          accountSteps.push({ name: S.CREATE_POSTAL_ADDRESSES, type: 'sync' });
          accountSteps.push({ name: S.SET_ADDRESS_DEFAULTS, type: 'sync' });
        }

        if (orders.length > 0) {
          orderSteps.push({ name: S.SYNC_DELAY_ORDERS, type: 'sync' });
          orderSteps.push({ name: S.GENERATE_ORDER_DATA, type: 'sync' });
          orderSteps.push({ name: S.CREATE_ORDERS, type: 'sync' });
        }

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

        const context = {
          config,
          options: {
            ...options,
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
          specificationDefinitions,
          optionDefinitions,
        };

        await persistenceService.createSession({
          sessionId,
          flowType: 'generate',
          status: 'STARTED',
          currentSteps: [],
          correlationId: config.correlationId,
          sessionName: options.sessionName || `Seed Pack: ${options.seedPack}`,
          context,
        });

        progressService.sessionStarted({
          sessionId,
          flowType: 'generate',
          correlationId: config.correlationId,
        });

        batchCallbackService._checkSessionCompletion(
          sessionId,
          config.correlationId
        );

        logger.info('Seed pack generation workflow started', {
          correlationId: config.correlationId,
          sessionId,
          seedPack: options.seedPack,
        });

        return res.json({
          success: true,
          sessionId,
          message: 'Seed pack generation workflow started successfully.',
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      }

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

      try {
        const steps = [];
        let flowType = 'generate';

        const productSteps = [];
        const accountSteps = [];
        const orderSteps = [];

        if (options.productCount > 0) {
          // Filter out null/invalid categories
          if (Array.isArray(options.categories)) {
            options.categories = options.categories.filter((c) => c != null);
          } else if (options.categories == null) {
            options.categories = [];
          }

          productSteps.push({ name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' });
          productSteps.push({ name: S.CREATE_WAREHOUSES, type: 'sync' });
          productSteps.push({ name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' });
          productSteps.push({ name: S.LINK_WAREHOUSE_CHANNELS, type: 'sync' });
          productSteps.push({ name: S.GENERATE_PRODUCT_DATA, type: 'sync' });
          productSteps.push({ name: S.ENSURE_CATEGORIES, type: 'sync' });
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

          if (options.generatePriceLists) {
            productSteps.push({ name: S.UPDATE_CATALOG_CONFIG, type: 'sync' });
          }

          if (options.generateBulkPricing) {
            productSteps.push({ name: S.GENERATE_BULK_PRICING, type: 'sync' });
          }

          if (options.generateTierPricing) {
            productSteps.push({ name: S.GENERATE_TIER_PRICING, type: 'sync' });
          }

          productSteps.push({
            type: 'parallel',
            steps: [
              { name: S.ATTACH_IMAGES, type: 'sync' },
              { name: S.ATTACH_PDFS, type: 'sync' },
              { name: S.UPDATE_INVENTORY, type: 'sync' },
            ],
          });
        }

        if (options.accountCount > 0) {
          accountSteps.push({ name: S.LOAD_COUNTRIES, type: 'sync' });
          accountSteps.push({ name: S.GENERATE_ACCOUNT_DATA, type: 'sync' });
          accountSteps.push({ name: S.CREATE_ACCOUNTS, type: 'sync' });
          accountSteps.push({ name: S.RESOLVE_ACCOUNT_IDS, type: 'sync' });
          accountSteps.push({ name: S.CREATE_POSTAL_ADDRESSES, type: 'sync' });
          accountSteps.push({ name: S.SET_ADDRESS_DEFAULTS, type: 'sync' });
        }

        if (options.orderCount > 0) {
          orderSteps.push({ name: S.GENERATE_ORDER_DATA, type: 'sync' });
          orderSteps.push({ name: S.CREATE_ORDERS, type: 'sync' });
        }

        // COMPOSE WORKFLOW WITH CLEAR DEPENDENCIES
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

        const promoSteps = [];
        if (options.generatePromotions && options.productCount > 0) {
          promoSteps.push({ name: S.GENERATE_PROMO_DATA, type: 'sync' });
          promoSteps.push({ name: S.CREATE_USER_SEGMENTS, type: 'sync' });
          promoSteps.push({ name: S.CREATE_PROMOTIONS, type: 'sync' });
        }

        if (promoSteps.length > 0) {
          steps.push({
            name: 'subflow-promotions',
            type: 'sequence',
            steps: promoSteps,
          });
        }

        // Orders only start after products and accounts subflows are terminal
        if (orderSteps.length > 0) {
          steps.push({
            name: 'subflow-orders',
            type: 'sequence',
            steps: orderSteps,
          });
        }

        if (
          options.accountCount > 0 &&
          !options.productCount &&
          !options.orderCount
        ) {
          flowType = 'accounts';
        } else if (
          options.orderCount > 0 &&
          !options.productCount &&
          !options.accountCount
        ) {
          flowType = 'orders';
        }

        if (steps.length === 0) {
          return res.json({
            success: false,
            error: 'No generation options selected.',
          });
        }

        const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

        await persistenceService.createSession({
          sessionId,
          flowType: flowType,
          status: 'STARTED',
          currentSteps: [],
          correlationId: config.correlationId,
          sessionName: options.sessionName,
          context: {
            config,
            options,
            steps,
            generator: 'unified',
          },
        });

        progressService.sessionStarted({
          sessionId,
          flowType,
          correlationId: config.correlationId,
        });

        batchCallbackService._checkSessionCompletion(
          sessionId,
          config.correlationId
        );

        logger.info('Generation workflow started', {
          correlationId: config.correlationId,
          sessionId,
        });

        return res.json({
          success: true,
          sessionId,
          message: 'Generation workflow started successfully.',
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const errorReference =
          resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

        emitRouteError(progressService, {
          error,
          fallbackMessage: 'Generation workflow failed to start',
          operation: 'generate-workflow',
          entityType: 'workflow',
          correlationId: config.correlationId,
          errorReference,
        });

        return handleError(
          res,
          logger,
          req,
          config,
          'generate-workflow',
          Object.assign(error, { errorReference }),
          {
            entityType: 'workflow',
            sanitizeConfig: sanitizedObject(config),
            sanitizeOptions: sanitizedObject(options),
          }
        );
      }
    }
  );
};
