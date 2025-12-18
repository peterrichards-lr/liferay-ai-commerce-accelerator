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

  const cacheService = new CacheService(ctx);
  ctx.cache = cacheService;

  const persistenceService = new PersistenceService();
  ctx.persistenceService = persistenceService;

  const progressService = new ProgressService({
    ws,
    logger,
    persistenceService,
  });
  ctx.progressService = progressService;

  const oauthService = new OAuthService({ cacheService, logger });
  ctx.oauthService = oauthService;

  const configService = new ConfigService({
    cache: cacheService,
    logger,
  });
  ctx.configService = configService;

  const liferayService = new LiferayService({
    oauthService,
    logger,
    cache: cacheService,
    configService,
  });
  ctx.liferay = liferayService;

  configService.setLiferayService(liferayService);

  const batchProcessorService = new BatchProcessorService({ logger });
  ctx.batchProcessor = batchProcessorService;

  const promptService = new PromptService(ctx);
  ctx.promptService = promptService;

  const healthService = new HealthService({ configService });
  ctx.health = healthService;

  const aiService = new AIService({
    configService,
    logger,
    promptService,
    ENV,
  });
  ctx.ai = aiService;

  const objectStorageService = new ObjectStorageService({
    configService,
    logger,
  });
  ctx.objectStorage = objectStorageService;

  const mediaGenerator = new MediaGenerator({
    configService,
    objectStorage: objectStorageService,
    logger,
  });
  ctx.media = mediaGenerator;

  const mockDataGenerator = new MockDataGenerator({ logger });
  ctx.mockData = mockDataGenerator;

  const entityGeneratorCtx = {
    ai: aiService,
    persistenceService,
    batchProcessor: batchProcessorService,
    cache: cacheService,
    configService: configService,
    liferay: liferayService,
    logger,
    media: mediaGenerator,
    mockData: mockDataGenerator,
    progressService,
  };

  const warehouseGenerator = new WarehouseGenerator(entityGeneratorCtx);
  entityGeneratorCtx.warehouseGenerator = warehouseGenerator;

  const accountGenerator = new AccountGenerator(entityGeneratorCtx);
  const orderGenerator = new OrderGenerator(entityGeneratorCtx);
  const productGenerator = new ProductGenerator(entityGeneratorCtx);

  const batchCallbackService = new BatchCallbackService({
    ...ctx,
    persistenceService,
    accountGenerator,
    productGenerator,
  });
  ctx.batchCallbackService = batchCallbackService;

  const deleteCoordinatorService = new DeleteCoordinatorService({
    ...ctx,
    cache: cacheService,
    liferay: liferayService,
    batchCallbackService,
    persistenceService,
  });
  ctx.deleteCoordinator = deleteCoordinatorService;
  ctx.deleteCoordinatorService = deleteCoordinatorService;

  entityGeneratorCtx.batchCallbackService = batchCallbackService;
  entityGeneratorCtx.deleteCoordinatorService = deleteCoordinatorService;

  const queueService = new QueueService({
    logger,
    configService,
    cacheService,
  });
  ctx.queueService = queueService;

  registerDataGenerationWorkers({
    queueService,
    logger,
    productGenerator,
    accountGenerator,
    orderGenerator,
    mockDataGenerator,
  });

  return {
    accountGenerator,
    aiService,
    batchCallbackService,
    cacheService,
    configService,
    deleteCoordinatorService,
    healthService,
    liferayService,
    mediaGenerator,
    mockDataGenerator,
    oauthService,
    orderGenerator,
    productGenerator,
    objectStorageService,
    persistenceService,
    progressService,
    promptService,
    queueService,
    warehouseGenerator,
  };
};