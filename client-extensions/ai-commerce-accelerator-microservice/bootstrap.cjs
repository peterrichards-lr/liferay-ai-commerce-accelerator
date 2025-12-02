const { logger } = require('./utils/logger.cjs');
const { ENV } = require('./utils/constants.cjs');

const { AIService } = require('./services/aiService.cjs');
const BatchCallbackService = require('./services/batchCallbackService.cjs');
const BatchPollingService = require('./services/batchPollingService.cjs');
const BatchProcessorService = require('./services/batchProcessorService.cjs');
const CacheService = require('./services/cacheService.cjs');
const ConfigService = require('./services/configService.cjs');
const DeleteCoordinatorService = require('./services/deleteCoordinatorService.cjs');
const LiferayService = require('./services/liferayService.cjs');
const { ObjectStorageService } = require('./services/objectStorageService.cjs');
const OAuthService = require('./services/oAuthService.cjs');
const { get: getWs } = require('./services/wsBus.cjs');
const HealthService = require('./services/healthService.cjs');
const { PromptService } = require('./services/promptService.cjs');
const { QueueService } = require('./services/queueService.cjs');

const AccountGenerator = require('./generators/accountGenerator.cjs');
const MediaGenerator = require('./generators/mediaGenerator.cjs');
const MockDataGenerator = require('./generators/mockDataGenerator.cjs');
const OrderGenerator = require('./generators/orderGenerator.cjs');
const ProductGenerator = require('./generators/productGenerator.cjs');

const registerDataGenerationWorkers = require('./workers/dataGenerationWorkers.cjs');

const ctx = { logger, getWs };

const cacheService = new CacheService(ctx);
ctx.cache = cacheService;

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

const batchPollingService = new BatchPollingService({
  logger,
  liferay: liferayService,
  cache: cacheService,
  getWs,
  configService,
});
ctx.batchPolling = batchPollingService;

const entityGeneratorCtx = {
  ai: aiService,
  batchPolling: batchPollingService,
  batchProcessor: batchProcessorService,
  cache: cacheService,
  liferay: liferayService,
  logger,
  media: mediaGenerator,
  mockData: mockDataGenerator,
  getWs,
};

const accountGenerator = new AccountGenerator(entityGeneratorCtx);
const orderGenerator = new OrderGenerator(entityGeneratorCtx);
const productGenerator = new ProductGenerator(entityGeneratorCtx);

batchPollingService.setProductGenerator(productGenerator);

const batchCallbackService = new BatchCallbackService(ctx);
ctx.batchCallbackService = batchCallbackService;

const deleteCoordinatorService = new DeleteCoordinatorService({
  cache: cacheService,
  liferay: liferayService,
  batchPolling: batchPollingService,
  logger,
  batchCallbackService,
});
ctx.deleteCoordinator = deleteCoordinatorService;
ctx.deleteCoordinatorService = deleteCoordinatorService;

batchCallbackService.setDeleteCoordinatorService(deleteCoordinatorService);

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

module.exports = {
  accountGenerator,
  aiService,
  batchCallbackService,
  batchPollingService,
  batchProcessorService,
  cacheService,
  configService,
  deleteCoordinatorService,
  getWs,
  healthService,
  liferayService,
  mediaGenerator,
  mockDataGenerator,
  oauthService,
  orderGenerator,
  productGenerator,
  objectStorageService,
  promptService,
  queueService,
};
