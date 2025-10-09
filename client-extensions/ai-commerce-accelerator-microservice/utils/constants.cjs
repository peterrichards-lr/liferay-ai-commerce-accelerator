const { lookupConfig, lxcConfig } = require('@rotty3000/config-node');

const applicationExternalReferenceCodes = {
  OAUTH_AGENT_EXTERNAL_REFERENCE_CODE: lookupConfig(
    'main.liferay.agent.oauth.application'
  ),

  OAUTH_SERVER_EXTERNAL_REFERENCE_CODE: lookupConfig(
    'main.liferay.server.oauth.application'
  ),
};

const env = {
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
};

module.exports = {
  applicationExternalReferenceCodes,
  env,
};
