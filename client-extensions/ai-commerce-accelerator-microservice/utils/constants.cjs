const { lookupConfig } = require('@rotty3000/config-node');
const { v4: uuidv4 } = require('uuid');

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function num(key, def, min) {
  const raw = lookupConfig(key);
  const n = toNumber(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(n, min);
}
function str(key, def) {
  const v = lookupConfig(key);
  return v !== undefined && v !== null ? String(v) : def;
}
function bool(key, def) {
  const v = lookupConfig(key);
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return def;
}
function list(key, def) {
  const v = lookupConfig(key);
  if (!v) return def;
  if (Array.isArray(v)) return v;
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const APP_ERCS = {
  PRODUCT_DATA_AI_SCHEMA: 'AICA-SCHEMA-PRODUCT',
  ACCOUNT_DATA_AI_SCHEMA: 'AICA-SCHEMA-ACCOUNT',
  ORDER_DATA_AI_SCHEMA: 'AICA-SCHEMA-ORDER',
  WAREHOUSE_DATA_AI_SCHEMA: 'AICA-SCHEMA-WAREHOUSE',
  PRICING_DATA_AI_SCHEMA: 'AICA-SCHEMA-PRICING',
  PRODUCT_DATA_AI_PROMPT: 'AICA-PROMPT-PRODUCT',
  ACCOUNT_DATA_AI_PROMPT: 'AICA-PROMPT-ACCOUNT',
  ORDER_DATA_AI_PROMPT: 'AICA-PROMPT-ORDER',
  WAREHOUSE_DATA_AI_PROMPT: 'AICA-PROMPT-WAREHOUSE',
  PRICING_DATA_AI_PROMPT: 'AICA-PROMPT-PRICING',
  OAUTH_SERVER_EXTERNAL_REFERENCE_CODE:
    'liferay-ai-commerce-accelerator-microservice-oauth-application-headless-server',
};

const ABS_MIN = {
  WS_HEARTBEAT_INTERVAL_MS: 10000,
  WS_RETRY_INTERVAL_MS: 300,
  WS_MAX_RETRIES: 3,
  CACHE_MAX_SIZE: 500,
  CACHE_DEFAULT_TTL: 60000,
  CONFIG_DEFAULT_TTL: 360000,
  BATCH_MIN_POLL_INTERVAL: 2000,
  BATCH_POLL_INTERVAL: 5000,
  BATCH_MAX_ATTEMPTS: 30,
  BATCH_MAX_RETRIES: 0,
  QUEUE_CONCURRENCY: 1,
  QUEUE_MAX_RETRIES: 1,
  QUEUE_RETRY_DELAY: 1000,
  QUEUE_JOB_TIMEOUT: 10000,
  QUEUE_CLEANUP_INTERVAL: 120000,
  QUEUE_JOB_TTL: 60000,
  OAUTH_HTTP_TIMEOUT_MS: 3000,
  OAUTH_MAX_RETRIES: 0,
  OAUTH_RETRY_BACKOFF_MS: 100,
  OAUTH_TOKEN_SKEW_SEC: 0,
  OAUTH_TOKEN_CACHE_TTL: 360000,
  OBJECT_STORAGE_SIGNED_URL_TTL_SEC: 60,
};

const QUEUE_CONFIG = {
  DEFAULT_CONCURRENCY: num(
    'QUEUE_DEFAULT_CONCURRENCY',
    2,
    ABS_MIN.QUEUE_CONCURRENCY
  ),
  MAX_RETRIES: num('QUEUE_MAX_RETRIES', 3, ABS_MIN.QUEUE_MAX_RETRIES),
  RETRY_DELAY: num('QUEUE_RETRY_DELAY', 5000, ABS_MIN.QUEUE_RETRY_DELAY),
  JOB_TIMEOUT: num('QUEUE_JOB_TIMEOUT', 300000, ABS_MIN.QUEUE_JOB_TIMEOUT),
  CLEANUP_INTERVAL: num(
    'QUEUE_CLEANUP_INTERVAL',
    300000,
    ABS_MIN.QUEUE_CLEANUP_INTERVAL
  ),
  JOB_TTL: num('QUEUE_JOB_TTL', 3600000, ABS_MIN.QUEUE_JOB_TTL),
};

// Environment variables and their defaults
const ENV = {
  // AI Service configuration
  AI_MODEL: str('AI_MODEL', 'gpt-4o-mini'),
  AI_SERVICE_URL: str('AI_SERVICE_URL', 'https://api.openai.com/v1'),
  OPENAI_API_KEY: str('OPENAI_API_KEY', ''),
  GEMINI_API_KEY: str('GEMINI_API_KEY', ''),

  // Liferay connection
  LIFERAY_API_URL: str('LIFERAY_API_URL', 'http://localhost:8080'),
  LIFERAY_API_USERNAME: str('LIFERAY_API_USERNAME', 'test@liferay.com'),
  LIFERAY_API_PASSWORD: str('LIFERAY_API_PASSWORD', 'test'),
  LIFERAY_COMPANY_ID: num('LIFERAY_COMPANY_ID', 20101),
  LIFERAY_OAUTH_CLIENT_ID: str(
    'LIFERAY_OAUTH_CLIENT_ID',
    'id-f075bd58-1ab9-595d-ede3-34b86b79233'
  ),
  LIFERAY_OAUTH_CLIENT_SECRET: str('LIFERAY_OAUTH_CLIENT_SECRET', 'secret'),

  // Internal microservice configuration
  MICROSERVICE_URL: str('MICROSERVICE_URL', 'http://localhost:3001'),
  SERVER_PORT: num('SERVER_PORT', 3001),
  SERVER_HOST: str('SERVER_HOST', '0.0.0.0'),
  LOGGER_LEVEL: str('logger.level', 'info'),
  LOGGER_PRETTY: bool('logger.pretty', false),
  NODE_ENV: str('NODE_ENV', 'development'),
  SERVICE_NAME: str('SERVICE_NAME', 'liferay-ai-data-microservice'),
  SERVICE_VERSION: str('SERVICE_VERSION', '1.0.0'),
  DEFAULT_LOCALE: str('DEFAULT_LOCALE', 'en-US'),
  SQLITE_DB_PATH: str('SQLITE_DB_PATH', './data/workflows.db'),
  BATCH_CACHE_TTL_MS: num('BATCH_CACHE_TTL_MS', 3600000, 0), // 1 hour
  API_REQUEST_TIMEOUT_MS: num('API_REQUEST_TIMEOUT_MS', 15000, 0), // 15 seconds
  WS_HEARTBEAT_MS: num(
    'WS_HEARTBEAT_INTERVAL_MS',
    30000,
    ABS_MIN.WS_HEARTBEAT_INTERVAL_MS
  ),
  WS_RETRY_INTERVAL_MS: num(
    'WS_RETRY_INTERVAL_MS',
    500,
    ABS_MIN.WS_RETRY_INTERVAL_MS
  ),
  WS_MAX_RETRIES: num('WS_MAX_RETRIES', 5, ABS_MIN.WS_MAX_RETRIES),
  QUEUE_GEN_CONCURRENCY: num('QUEUE_GEN_CONCURRENCY', 2, 1),
  QUEUE_PDF_CONCURRENCY: num('QUEUE_PDF_CONCURRENCY', 1, 1),
  QUEUE_NOTIFY_CONCURRENCY: num('QUEUE_NOTIFY_CONCURRENCY', 5, 1),
  POLLING_DELAY_MS: num('POLLING_DELAY_MS', 5000, 100), // 5 seconds
  POLLING_RETRIES: num('POLLING_RETRIES', 12, 1), // 1 minute total
  MAX_DELTA_FETCH_RETRIES: num('MAX_DELTA_FETCH_RETRIES', 5, 1),
  RETRY_BACKOFF_MS: num('RETRY_BACKOFF_MS', 1000, 100),
  GRAPHQL_RETRY_ATTEMPTS: num('GRAPHQL_RETRY_ATTEMPTS', 10, 1),
  // New delay for Liferay inter-service sync
  LIFERAY_SYNC_DELAY_MS: num('LIFERAY_SYNC_DELAY_MS', 3000, 0), // 3 seconds

  // Generation configuration
  BATCH_SIZE: num('BATCH_SIZE', 10, 1),
  IMAGE_HEIGHT: num('IMAGE_HEIGHT', 512, 128),
  IMAGE_WIDTH: num('IMAGE_WIDTH', 512, 128),
  IMAGE_MODE: str('IMAGE_MODE', 'placeholder'), // 'none', 'ai', 'picsum', 'placeholder', 'custom'
  IMAGE_QUALITY: str('IMAGE_QUALITY', 'standard'), // 'standard', 'hd'
  IMAGE_RATIO: num('IMAGE_RATIO', 80, 0), // 80% of products get images
  IMAGE_STYLE: str('IMAGE_STYLE', 'photographic'),
  PDF_MODE: str('PDF_MODE', 'placeholder'), // 'none', 'ai', 'placeholder', 'custom'
  PDF_RATIO: num('PDF_RATIO', 50, 0), // 50% of products get PDFs
  INVENTORY_ASSIGNMENT_RATIO: num('INVENTORY_ASSIGNMENT_RATIO', 80, 0), // 80% of SKUs get assigned inventory
  INVENTORY_MIN: num('INVENTORY_MIN', 10, 0),
  INVENTORY_MAX: num('INVENTORY_MAX', 100, 0),
  PRICING_PROMOTION_RATIO: num('PRICING_PROMOTION_RATIO', 0.2, 0), // 20% of products get a promotion
  PRICING_BULK_RATIO: num('PRICING_BULK_RATIO', 0.15, 0), // 15% of products get bulk pricing
  PRICING_TIER_RATIO: num('PRICING_TIER_RATIO', 0.15, 0), // 15% of products get tier pricing

  // Exclusions (comma separated externalReferenceCodes)
  EXCLUDE_LISTS: list('EXCLUDE_LISTS', []),
  EXCLUDE_ACCOUNTS: list('EXCLUDE_ACCOUNTS', ['Test Test']),

  // Object Storage configuration
  OBJECT_STORAGE_MODE: str('OBJECT_STORAGE_MODE', 'none'), // 'none', 'gcs'
  OBJECT_STORAGE_BUCKET_NAME: str('OBJECT_STORAGE_BUCKET_NAME', ''),
  OBJECT_STORAGE_UPLOAD_PREFIX: str('OBJECT_STORAGE_UPLOAD_PREFIX', 'uploads'),
  OBJECT_STORAGE_SIGNED_URL_TTL_SEC: num(
    'OBJECT_STORAGE_SIGNED_URL_TTL_SEC',
    900,
    60
  ), // 15 minutes
  OBJECT_STORAGE_SIDECAR_ENDPOINT: str(
    'OBJECT_STORAGE_SIDECAR_ENDPOINT',
    'http://127.0.0.1:1106'
  ),
};

// External Reference Code Prefixes
const ERC_PREFIX = {
  ACCOUNT: 'AICA-ACC',
  BATCH: 'AICA-BATCH',
  BATCH_DELETION: 'AICA-DEL-BATCH',
  BATCH_GENERATION: 'AICA-GEN-BATCH',
  BATCH_SESSION: 'AICA-SESSION',
  INVENTORY_BATCH: 'AICA-INV-BATCH',
  ORDER: 'AICA-ORD',
  ORDER_BATCH: 'AICA-ORD-BATCH',
  OPTION: 'AICA-OPT',
  OPTION_CATEGORY: 'AICA-OPT-CAT',
  PRICE_LIST: 'AICA-PL',
  PRICE_ENTRY: 'AICA-PE',
  PRICEENTRY_BATCH: 'AICA-PE-BATCH',
  PRODUCT: 'AICA-PRD',
  SPECIFICATION: 'AICA-SPEC',
  SPECIFICATION_CATEGORY: 'AICA-SPEC-CAT',
  WAREHOUSE: 'AICA-WH',
  ADDRESS: 'AICA-ADDR',
  TIER_PRICE: 'AICA-TP',
};

const IMAGE_BATCH_ID = uuidv4();
const PDF_BATCH_ID = uuidv4();

const OP_MAP = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  UPSERT: 'upsert',
};

// WebSocket Event Types and Scopes
const WEB_SOCKET_EVENTS = {
  // New Unified Event Types
  STARTED: 'STARTED',
  PROGRESS: 'PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',

  // Legacy Event Types (keeping for transition)
  BATCH_COMPLETED: 'batch_completed',
  BATCH_PROGRESS: 'batch_progress',
  BATCH_START: 'batch_start',
  BATCH_FAILED: 'batch_failed',
  BATCH_SUBSCRIPTION_CONFIRMED: 'batch_subscription_confirmed',
  BATCH_ERROR_DETAILS: 'batch_error_details',
  ERROR: 'error',
  GENERATION_PROGRESS: 'generation_progress',
  GENERATION_SESSION_COMPLETE: 'generation_session_complete',
  POSTPROC_COMPLETED: 'post_processing_completed',
  POSTPROC_PROGRESS: 'post_processing_progress',
  POSTPROC_STARTED: 'post_processing_started',
  SESSION_COMPLETE: 'session_completed',
  PONG: 'pong',
};

const WS_SCOPE = {
  BATCH: 'batch',
  SESSION: 'session',
  STEP: 'step',
};

const WS_OPERATION = {
  GENERATE: 'generate',
  DELETE: 'delete',
  PROCESS_IMAGES: 'process-images',
  PROCESS_ATTACHMENTS: 'process-attachments',
};

const CONFIG_ERCS = {
  CACHE_CONFIG: 'CACHE-CONFIG',
  QUEUE_CONFIG: 'QUEUE-CONFIG',
  AI_CONFIG: 'AI-CONFIG',
  OAUTH_CONFIG: 'OAUTH-CONFIG',
  OBJECT_STORAGE_CONFIG: 'OBJECT-STORAGE-CONFIG',
  WS_CONFIG: 'WS-CONFIG',
  BATCH_SIZES: 'BATCH-SIZES',
  AI_MODEL_OPTIONS: 'AI-MODEL-OPTIONS',
  EXCLUDE_LISTS: 'AI-EXCLUDE-LISTS',
};

const COMMERCE_CONSTRAINTS = {
  FIELD_TYPES_WITH_VALUES: [
    'checkbox',
    'checkbox_multiple',
    'radio',
    'select',
    'select_date',
  ],
  OPTION_NAME_MAX_LENGTH: 75,
  SKU_CODE_MAX_LENGTH: 75,
  MAX_PRICE_ENTRY_ERC_LENGTH: 60, // Max length for COMMERCEPRICEENTRY.EXTERNALREFERENCECODE is 75, so leave a buffer
};

module.exports = {
  APP_ERCS,
  ENV,
  ERC_PREFIX,
  ABS_MIN,
  QUEUE_CONFIG,
  IMAGE_BATCH_ID,
  OP_MAP,
  PDF_BATCH_ID,
  WEB_SOCKET_EVENTS,
  WS_SCOPE,
  WS_OPERATION,
  CONFIG_ERCS,
  COMMERCE_CONSTRAINTS,
};
