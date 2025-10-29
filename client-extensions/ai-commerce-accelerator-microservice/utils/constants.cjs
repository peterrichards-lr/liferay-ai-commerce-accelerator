const { lookupConfig, lxcConfig } = require('@rotty3000/config-node');

const APP_ERCS = Object.freeze({
  OAUTH_AGENT_EXTERNAL_REFERENCE_CODE: lookupConfig(
    'main.liferay.agent.oauth.application'
  ),

  OAUTH_SERVER_EXTERNAL_REFERENCE_CODE: lookupConfig(
    'main.liferay.server.oauth.application'
  ),
});

const APP_PREFIX = 'AICA';
const ERC_PREFIX = Object.freeze({
  ACCOUNT: `${APP_PREFIX}-ACC`,
  ACCOUNT_BATCH: `${APP_PREFIX}-ACC-BATCH`,
  BATCH_SESSION: `${APP_PREFIX}-SESSION`,
  ERROR: `${APP_PREFIX}-ERR`,
  IMAGE: `${APP_PREFIX}-IMG`,
  ORDER: `${APP_PREFIX}-ORD`,
  ORDER_BATCH: `${APP_PREFIX}-ORD-BATCH`,
  PDF: `${APP_PREFIX}-PDF`,
  PRODUCT: `${APP_PREFIX}-PRD`,
  PRODUCT_BATCH: `${APP_PREFIX}-PRD-BATCH`,
  SPECIFICATION_CATEGORY: `${APP_PREFIX}-SPEC-CAT`,
  SPECIFICATION: `${APP_PREFIX}-SPEC`,
});

const env = Object.freeze({
  NODE_ENV: lookupConfig('node.env') || 'development',
  LOGGER_LEVEL: (lookupConfig('logger.level') || 'debug').toLowerCase(),
  CACHE_MAX_SIZE: lookupConfig('cache.max.size') || 1000,
  CACHE_DEFAULT_TTL: lookupConfig('cache.default.ttl') || 300000,
  PUBLIC_OBJECT_SEARCH_PATHS: lookupConfig('public.object.search.paths') || '',
  PRIVATE_OBJECT_DIR: lookupConfig('private.object.dir') || '',
  TEST_CLIENT_SECRET: lookupConfig('test.client.secret') || 'test-secret-key',
  LOG_PRETTY: lookupConfig('logger.pretty') || false,
  SERVICE_NAME: lookupConfig('service.name') || 'liferay-ai-data-microservice',
  SERVICE_VERSION: lookupConfig('service.version') || '1.0.0',
});

module.exports = {
  APP_ERCS,
  env,
  ERC_PREFIX,
};
