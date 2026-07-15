const { logger } = require('./utils/logger.cjs');
const { ENV } = require('./utils/constants.cjs');

const { AIService } = require('./services/aiService.cjs');
const BatchCallbackService = require('./services/batch/callback.cjs');
const BatchProcessorService = require('./services/batch/processor.cjs');
const CacheService = require('./services/cacheService.cjs');
const ConfigService = require('./services/configService.cjs');
const DeleteCoordinatorService = require('./services/deleteCoordinatorService.cjs');
const { LiferayService } = require('./services/liferay/index.cjs');
const { ObjectStorageService } = require('./services/objectStorageService.cjs');
const PersistenceService = require('./services/persistenceService.cjs');
const ContractValidator = require('./services/contractValidator.cjs');

const OAuthService = require('./services/liferay/oauth.cjs');
const HealthService = require('./services/healthService.cjs');
const { PromptService } = require('./services/promptService.cjs');
const { QueueService } = require('./services/queueService.cjs');
const ProgressService = require('./services/progressService.cjs');

const AccountGenerator = require('./generators/accountGenerator.cjs');
const MediaGenerator = require('./generators/mediaGenerator.cjs');
const MockDataGenerator = require('./generators/mockDataGenerator.cjs');
const OrderGenerator = require('./generators/orderGenerator.cjs');
const ProductGenerator = require('./generators/productGenerator.cjs');
const WarehouseGenerator = require('./generators/warehouseGenerator.cjs');
const { PromoGenerator } = require('./generators/PromoGenerator.cjs');
const WorkflowCoordinator = require('./generators/workflowCoordinator.cjs');

const registerDataGenerationWorkers = require('./workers/dataGenerationWorkers.cjs');
const registerBatchWorkers = require('./workers/registerBatchWorkers.cjs');

module.exports = async (ws) => {
  const ctx = { logger, ws };

  ctx.cache = new CacheService(ctx);
  ctx.persistence = new PersistenceService(ctx);
  ctx.contractValidator = new ContractValidator(ctx);
  ctx.progress = new ProgressService({
    ws,
    logger,
    persistence: ctx.persistence,
  });
  ctx.oauth = new OAuthService({ cache: ctx.cache, logger });
  ctx.config = new ConfigService({
    cache: ctx.cache,
    logger,
  });

  ctx.liferay = new LiferayService({
    oauth: ctx.oauth,
    logger,
    cache: ctx.cache,
    config: ctx.config,
  });

  ctx.config.setLiferayService(ctx.liferay);
  ctx.prompt = new PromptService(ctx);
  ctx.health = new HealthService({
    config: ctx.config,
    persistence: ctx.persistence,
    logger,
    liferay: ctx.liferay,
  });
  ctx.ai = new AIService({
    config: ctx.config,
    logger,
    prompt: ctx.prompt,
    ENV,
  });
  ctx.ai.initializeSchemas();
  ctx.batchProcessor = new BatchProcessorService({ logger });
  ctx.batchCallback = new BatchCallbackService(ctx);
  ctx.mockDataGenerator = new MockDataGenerator({
    logger,
    liferay: ctx.liferay,
  });
  ctx.objectStorage = new ObjectStorageService({
    config: ctx.config,
    logger,
  });
  ctx.media = new MediaGenerator(ctx);
  const { GenerationFacade } = require('./services/generationFacade.cjs');
  ctx.generation = new GenerationFacade(ctx);

  // Instantiate individual generators
  ctx.warehouseGenerator = new WarehouseGenerator(ctx);
  ctx.accountGenerator = new AccountGenerator(ctx);
  ctx.orderGenerator = new OrderGenerator(ctx);
  ctx.productGenerator = new ProductGenerator(ctx);
  ctx.promoGenerator = new PromoGenerator(ctx);
  ctx.workflowCoordinator = new WorkflowCoordinator(ctx);
  ctx.deleteCoordinator = new DeleteCoordinatorService(ctx);

  // Trigger search reindexing after successful workflow completion (Generation or Import)
  ctx.workflowCoordinator.onSessionComplete = async ({
    sessionId,
    correlationId,
    session,
  }) => {
    try {
      if (session && session.context && session.context.config) {
        // Trigger reindex for CPDefinition (Commerce Catalog Products)
        await ctx.liferay.rest.triggerReindex(
          session.context.config,
          'com.liferay.commerce.product.model.CPDefinition'
        );
        logger.info(
          `Search reindexing triggered after workflow session completed: ${sessionId}`,
          { correlationId }
        );
      }
    } catch (reindexErr) {
      logger.warn(
        `Failed to trigger search reindexing after workflow session ${sessionId}`,
        {
          correlationId,
          error: reindexErr.message,
        }
      );
    }
  };

  // Register generators with the master coordinator
  ctx.workflowCoordinator.registerGenerator(
    'warehouse',
    ctx.warehouseGenerator
  );
  ctx.workflowCoordinator.registerGenerator('account', ctx.accountGenerator);
  ctx.workflowCoordinator.registerGenerator('order', ctx.orderGenerator);
  ctx.workflowCoordinator.registerGenerator('product', ctx.productGenerator);
  ctx.workflowCoordinator.registerGenerator('promo', ctx.promoGenerator);
  ctx.workflowCoordinator.registerGenerator('delete', ctx.deleteCoordinator);

  // Register generators with the callback dispatcher
  ctx.batchCallback.registerGenerator('warehouse', ctx.warehouseGenerator);
  ctx.batchCallback.registerGenerator('account', ctx.accountGenerator);
  ctx.batchCallback.registerGenerator('order', ctx.orderGenerator);
  ctx.batchCallback.registerGenerator('product', ctx.productGenerator);
  ctx.batchCallback.registerGenerator('promo', ctx.promoGenerator);
  ctx.batchCallback.registerGenerator('delete', ctx.deleteCoordinator);
  ctx.batchCallback.registerGenerator('unified', ctx.workflowCoordinator);

  // HARDENING: Verify that all registered generators have valid method handlers
  // for their registered workflow steps. Throws at startup if mapping is broken.
  ctx.warehouseGenerator.verifySteps();
  ctx.accountGenerator.verifySteps();
  ctx.orderGenerator.verifySteps();
  ctx.productGenerator.verifySteps();
  ctx.promoGenerator.verifySteps();
  ctx.deleteCoordinator.verifySteps();

  ctx.queue = new QueueService({
    logger,
    config: ctx.config,
    cache: ctx.cache,
    persistence: ctx.persistence,
  });

  registerDataGenerationWorkers({
    queue: ctx.queue,
    logger,
    productGenerator: ctx.productGenerator,
    accountGenerator: ctx.accountGenerator,
    orderGenerator: ctx.orderGenerator,
    mockDataGenerator: ctx.mockDataGenerator,
  });

  registerBatchWorkers({
    queue: ctx.queue,
    logger,
    batchCallbackService: ctx.batchCallback,
  });

  return {
    accountGenerator: ctx.accountGenerator,
    aiService: ctx.ai,
    batchCallbackService: ctx.batchCallback,
    cacheService: ctx.cache,
    configService: ctx.config,
    deleteCoordinatorService: ctx.deleteCoordinator,
    healthService: ctx.health,
    liferayService: ctx.liferay,
    mediaGenerator: ctx.media,
    mockDataGenerator: ctx.mockDataGenerator,
    oauthService: ctx.oauth,
    orderGenerator: ctx.orderGenerator,
    productGenerator: ctx.productGenerator,
    objectStorageService: ctx.objectStorage,
    persistenceService: ctx.persistence,
    progressService: ctx.progress,
    promptService: ctx.prompt,
    queueService: ctx.queue,
    promoGenerator: ctx.promoGenerator,
    warehouseGenerator: ctx.warehouseGenerator,
    workflowCoordinator: ctx.workflowCoordinator,
  };
};
