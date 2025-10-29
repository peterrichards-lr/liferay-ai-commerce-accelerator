const { logger } = require('./utils/logger.cjs');

const { AIService } = require('./services/aiService.cjs');
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

const AccountGenerator = require('./generators/accountGenerator.cjs');
const MediaGenerator = require('./generators/mediaGenerator.cjs');
const MockDataGenerator = require('./generators/mockDataGenerator.cjs');
const OrderGenerator = require('./generators/orderGenerator.cjs');
const ProductGenerator = require('./generators/productGenerator.cjs');


const ctx = { logger, getWs };

const cacheService = new CacheService(ctx);
ctx.cache = cacheService;

const oauthService = new OAuthService({ cacheService, logger });

const liferayService = new LiferayService({ oauthService, logger });

const batchProcessorService = new BatchProcessorService({ logger });

const configService = new ConfigService({
  cache: cacheService,
  logger,
  liferay: liferayService,
});

const healthService = new HealthService({ configService });
ctx.health = healthService;

const aiService = new AIService({
  configService,
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

const deleteCoordinatorService = new DeleteCoordinatorService({
  cache: cacheService,
  liferay: liferayService,
  logger,
});

module.exports = {
  accountGenerator,
  aiService,
  batchPollingService,
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
};
