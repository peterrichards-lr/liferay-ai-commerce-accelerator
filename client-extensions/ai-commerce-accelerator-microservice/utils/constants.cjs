const { lookupConfig } = require('@rotty3000/config-node');

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function num(key, def, min) {
  const raw = lookupConfig(key);
  const n = toNumber(raw);
  if (!Number.isFinite(n)) return def;
  if (typeof min === 'number' && n < min) return min;
  return n;
}
function bool(key, def = false) {
  const v = lookupConfig(key);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string')
    return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  return def;
}
function str(key, def = '') {
  const v = lookupConfig(key);
  return v === undefined || v === null || v === '' ? def : String(v);
}

const APP_ERCS = Object.freeze({
  OAUTH_AGENT_EXTERNAL_REFERENCE_CODE: str(
    'main.liferay.agent.oauth.application'
  ),
  OAUTH_SERVER_EXTERNAL_REFERENCE_CODE: str(
    'main.liferay.server.oauth.application'
  ),
});

const APP_PREFIX = 'AICA-';
const ERC_PREFIX = Object.freeze({
  ACCOUNT: `${APP_PREFIX}ACC`,
  ACCOUNT_BATCH: `${APP_PREFIX}ACC-BATCH`,
  BATCH_SESSION: `${APP_PREFIX}SESSION`,
  ERROR: `${APP_PREFIX}ERR`,
  IMAGE: `${APP_PREFIX}IMG`,
  ORDER: `${APP_PREFIX}ORD`,
  ORDER_BATCH: `${APP_PREFIX}ORD-BATCH`,
  PDF: `${APP_PREFIX}PDF`,
  PRODUCT: `${APP_PREFIX}PRD`,
  PRODUCT_BATCH: `${APP_PREFIX}PRD-BATCH`,
  SPECIFICATION_CATEGORY: `${APP_PREFIX}SPEC-CAT`,
  SPECIFICATION: `${APP_PREFIX}SPEC`,
});

const ABS_MIN = Object.freeze({
  WS_HEARTBEAT_INTERVAL_MS: 10_000,
  WS_RETRY_INTERVAL_MS: 300,
  WS_MAX_RETRIES: 3,

  CACHE_MAX_SIZE: 100,
  CACHE_DEFAULT_TTL: 60_000,
  CONFIG_DEFAULT_TTL: 60_000,
  BATCH_MIN_POLL_INTERVAL: 2_000,
  BATCH_POLL_INTERVAL: 5_000,
  BATCH_MAX_ATTEMPTS: 30,
  BATCH_MAX_RETRIES: 0,

  QUEUE_CONCURRENCY: 1,
  QUEUE_MAX_RETRIES: 1,
  QUEUE_RETRY_DELAY: 1_000,
  QUEUE_JOB_TIMEOUT: 10_000,
  QUEUE_CLEANUP_INTERVAL: 60_000,
  QUEUE_JOB_TTL: 60_000,

  OAUTH_HTTP_TIMEOUT_MS: 3_000,
  OAUTH_MAX_RETRIES: 0,
  OAUTH_RETRY_BACKOFF_MS: 100,
  OAUTH_TOKEN_SKEW_SEC: 0,
  OAUTH_TOKEN_CACHE_TTL: 60_000,
});

const ABS_MIN_AI = Object.freeze({
  TEMPERATURE: 0,
  MAX_TOKENS: 256,
  TIMEOUT_MS: 10_000,
  RETRY_MAX: 0,
  RETRY_BASE_MS: 250,
  RETRY_MAX_MS: 5_000,
  PARALLEL_LIMIT: 1,
});

const ENV = Object.freeze({
  NODE_ENV: str('node.env', 'development'),
  LOGGER_LEVEL: str('logger.level', 'debug').toLowerCase(),
  LOG_PRETTY: bool('logger.pretty', false),
  SERVICE_NAME: str('service.name', 'liferay-ai-data-microservice'),
  SERVICE_VERSION: str('service.version', '1.0.0'),

  AI_DEFAULT_MODEL: str('ai.default.model', 'gpt-4o'),
  AI_TEMPERATURE: num('ai.temperature', 0.7, ABS_MIN_AI.TEMPERATURE),
  AI_TIMEOUT_MS: num('ai.timeout.ms', 60_000, ABS_MIN_AI.TIMEOUT_MS),
  AI_RETRY_MAX: num('ai.retry.max', 2, ABS_MIN_AI.RETRY_MAX),
  AI_RETRY_BASE_MS: num('ai.retry.base.ms', 1_000, ABS_MIN_AI.RETRY_BASE_MS),
  AI_RETRY_MAX_MS: num('ai.retry.max.ms', 8_000, ABS_MIN_AI.RETRY_MAX_MS),
  AI_PARALLEL_LIMIT: num('ai.parallel.limit', 4, ABS_MIN_AI.PARALLEL_LIMIT),
  AI_RESPONSE_FORMAT: str('ai.response.format', 'json_object'),

  CACHE_MAX_SIZE: num(
    'cache.max.size',
    ABS_MIN.CACHE_MAX_SIZE,
    ABS_MIN.CACHE_MAX_SIZE
  ),
  CACHE_DEFAULT_TTL: num(
    'cache.default.ttl',
    ABS_MIN.CACHE_DEFAULT_TTL,
    ABS_MIN.CACHE_DEFAULT_TTL
  ),
  CONFIG_CACHE_TTL: num(
    'config.cache.ttl',
    ABS_MIN.CONFIG_DEFAULT_TTL,
    ABS_MIN.CONFIG_DEFAULT_TTL
  ),

  PUBLIC_OBJECT_SEARCH_PATHS: str('public.object.search.paths', ''),
  PRIVATE_OBJECT_DIR: str('private.object.dir', ''),
  TEST_CLIENT_SECRET: str('test.client.secret', 'test-secret-key'),

  BATCH_MIN_POLL_INTERVAL: num(
    'batch.poll.min.interval',
    ABS_MIN.BATCH_MIN_POLL_INTERVAL,
    ABS_MIN.BATCH_MIN_POLL_INTERVAL
  ),
  BATCH_POLL_INTERVAL: (() => {
    const requested = num(
      'batch.poll.interval',
      ABS_MIN.BATCH_POLL_INTERVAL,
      0
    );
    return Math.max(requested, ABS_MIN.BATCH_MIN_POLL_INTERVAL);
  })(),
  BATCH_MAX_ATTEMPTS: num(
    'batch.poll.max.attempts',
    ABS_MIN.BATCH_MAX_ATTEMPTS,
    ABS_MIN.BATCH_MAX_ATTEMPTS
  ),
  BATCH_MAX_RETRIES: num(
    'batch.poll.max.retries',
    ABS_MIN.BATCH_MAX_RETRIES,
    ABS_MIN.BATCH_MAX_RETRIES
  ),
  BATCH_TIMEOUT_MS: num('batch.poll.timeout.ms', 0, 0),

  OAUTH_HTTP_TIMEOUT_MS: num(
    'oauth.http.timeout.ms',
    ABS_MIN.OAUTH_HTTP_TIMEOUT_MS,
    ABS_MIN.OAUTH_HTTP_TIMEOUT_MS
  ),
  OAUTH_MAX_RETRIES: num(
    'oauth.max.retries',
    ABS_MIN.OAUTH_MAX_RETRIES,
    ABS_MIN.OAUTH_MAX_RETRIES
  ),
  OAUTH_RETRY_BACKOFF_MS: num(
    'oauth.retry.backoff.ms',
    ABS_MIN.OAUTH_RETRY_BACKOFF_MS,
    ABS_MIN.OAUTH_RETRY_BACKOFF_MS
  ),
  OAUTH_TOKEN_SKEW_SEC: num(
    'oauth.token.skew.sec',
    ABS_MIN.OAUTH_TOKEN_SKEW_SEC,
    ABS_MIN.OAUTH_TOKEN_SKEW_SEC
  ),
  OAUTH_TOKEN_CACHE_TTL: num(
    'oauth.token.cache.ttl',
    ABS_MIN.OAUTH_TOKEN_CACHE_TTL,
    ABS_MIN.OAUTH_TOKEN_CACHE_TTL
  ),

  WS_HEARTBEAT_INTERVAL_MS: num(
    'ws.heartbeat.interval.ms',
    30_000,
    ABS_MIN.WS_HEARTBEAT_INTERVAL_MS
  ),
  WS_RETRY_INTERVAL_MS: num(
    'ws.retry.interval.ms',
    500,
    ABS_MIN.WS_RETRY_INTERVAL_MS
  ),
  WS_MAX_RETRIES: num('ws.max.retries', 3, ABS_MIN.WS_MAX_RETRIES),
});

const QUEUE_CONFIG = Object.freeze({
  DEFAULT_CONCURRENCY: num(
    'queue.defaults.concurrency',
    Math.max(2, ABS_MIN.QUEUE_CONCURRENCY),
    ABS_MIN.QUEUE_CONCURRENCY
  ),
  MAX_RETRIES: num(
    'queue.defaults.max.retries',
    Math.max(3, ABS_MIN.QUEUE_MAX_RETRIES),
    ABS_MIN.QUEUE_MAX_RETRIES
  ),
  RETRY_DELAY: num(
    'queue.defaults.retry.delay',
    Math.max(5_000, ABS_MIN.QUEUE_RETRY_DELAY),
    ABS_MIN.QUEUE_RETRY_DELAY
  ),
  JOB_TIMEOUT: num(
    'queue.defaults.job.timeout',
    Math.max(300_000, ABS_MIN.QUEUE_JOB_TIMEOUT),
    ABS_MIN.QUEUE_JOB_TIMEOUT
  ),
  CLEANUP_INTERVAL: num(
    'queue.defaults.cleanup.interval',
    Math.max(300_000, ABS_MIN.QUEUE_CLEANUP_INTERVAL),
    ABS_MIN.QUEUE_CLEANUP_INTERVAL
  ),
  JOB_TTL: num(
    'queue.defaults.job.ttl',
    Math.max(3_600_000, ABS_MIN.QUEUE_JOB_TTL),
    ABS_MIN.QUEUE_JOB_TTL
  ),
});

module.exports = {
  APP_ERCS,
  ENV,
  ERC_PREFIX,
  ABS_MIN,
  QUEUE_CONFIG,
};
