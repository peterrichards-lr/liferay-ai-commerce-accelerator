const { logger } = require('./utils/logger.cjs');
const { ENV } = require('./utils/constants.cjs');

const { AIService } = require('./services/aiService.cjs');
const BatchCallbackService = require('./services/batchCallbackService.cjs');
const BatchProcessorService = require('./services/batchProcessorService.cjs');
const CacheService = require('./services/cacheService.cjs');
const ConfigService = require('./services/configService.cjs');
const DeleteCoordinatorService = require('./services/deleteCoordinatorService.cjs');
const LiferayService = require('./services/liferayService.cjs');
const { ObjectStorageService } = require('./services/objectStorageService.cjs');
const PersistenceService = require('./services/persistenceService.cjs');

const OAuthService = require('./services/oAuthService.cjs');
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

const registerDataGenerationWorkers = require('./workers/dataGenerationWorkers.cjs');

module.exports = (ws) => {
  const ctx = { logger, ws };

  ctx.cache = new CacheService(ctx);
  ctx.persistence = new PersistenceService();
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
  ctx.batchProcessor = new BatchProcessorService({ logger });
  ctx.prompt = new PromptService(ctx);
  ctx.health = new HealthService({ config: ctx.config });
  ctx.ai = new AIService({
    config: ctx.config,
    logger,
    prompt: ctx.prompt,
    ENV,
  });
  ctx.objectStorage = new ObjectStorageService({
    config: ctx.config,
    logger,
  });
  ctx.media = new MediaGenerator({
    config: ctx.config,
    objectStorage: ctx.objectStorage,
    logger,
  });
  ctx.mockData = new MockDataGenerator({ logger });

  const entityGeneratorCtx = {
    ai: ctx.ai,
    persistence: ctx.persistence,
    batchProcessor: ctx.batchProcessor,
    cache: ctx.cache,
    config: ctx.config,
    liferay: ctx.liferay,
    logger: ctx.logger,
    media: ctx.media,
    mockData: ctx.mockData,
    progress: ctx.progress,
  };

  ctx.warehouseGenerator = new WarehouseGenerator(entityGeneratorCtx);
  ctx.accountGenerator = new AccountGenerator(entityGeneratorCtx);
  ctx.orderGenerator = new OrderGenerator(entityGeneratorCtx);
  entityGeneratorCtx.warehouseGenerator = ctx.warehouseGenerator;
  ctx.productGenerator = new ProductGenerator(entityGeneratorCtx);

  ctx.batchCallback = new BatchCallbackService(ctx);
  ctx.deleteCoordinator = new DeleteCoordinatorService(ctx);

  ctx.queue = new QueueService({
    logger,
    config: ctx.config,
    cache: ctx.cache,
  });

  registerDataGenerationWorkers({
    queue: ctx.queue,
    logger,
    productGenerator: ctx.productGenerator,
    accountGenerator: ctx.accountGenerator,
    orderGenerator: ctx.orderGenerator,
    mockDataGenerator: ctx.mockData,
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
    mockDataGenerator: ctx.mockData,
    oauthService: ctx.oauth,
    orderGenerator: ctx.orderGenerator,
    productGenerator: ctx.productGenerator,
    objectStorageService: ctx.objectStorage,
    persistenceService: ctx.persistence,
    progressService: ctx.progress,
    promptService: ctx.prompt,
    queueService: ctx.queue,
    warehouseGenerator: ctx.warehouseGenerator,
  };
};