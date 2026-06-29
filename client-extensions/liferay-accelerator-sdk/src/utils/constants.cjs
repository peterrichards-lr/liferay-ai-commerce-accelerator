const { lookupConfig } = require('@rotty3000/config-node');
const crypto = require('crypto');

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function num(key, def, min) {
  let raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') raw = lookupConfig(key);
  const n = toNumber(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(n, min);
}
function str(key, def) {
  let v = process.env[key];
  if (v === undefined || v === null || v === '') v = lookupConfig(key);
  return v !== undefined && v !== null && v !== '' ? String(v) : def;
}
function bool(key, def) {
  let v = process.env[key];
  if (v === undefined || v === null || v === '') v = lookupConfig(key);
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return def;
}
function list(key, def) {
  let v = process.env[key];
  if (v === undefined || v === null || v === '') v = lookupConfig(key);
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

const EMPTY_PLACEHOLDER = '__AICA_EMPTY__';

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

  // Specific settings for callback processing to handle race conditions
  CALLBACK_MAX_RETRIES: 5,
  CALLBACK_RETRY_DELAY: 2000,
};

const JOB_TYPES = {
  DATA_GENERATION: 'data-generation',
  BATCH_CALLBACK_PROCESSING: 'batch-callback-processing',
};

// Environment variables and their defaults
const ENV = {
  // AI Service configuration
  AI_MODEL: str('AI_MODEL', 'gpt-4o-mini'),
  AI_SERVICE_URL: str('AI_SERVICE_URL', 'https://api.openai.com/v1'),
  OPENAI_API_KEY: str('OPENAI_API_KEY', ''),
  GEMINI_API_KEY: str('GEMINI_API_KEY', ''),

  // Liferay connection
  LIFERAY_API_URL: str('LIFERAY_API_URL', '') || str('LIFERAY_URL', ''),
  LIFERAY_API_USERNAME: str('LIFERAY_API_USERNAME', ''),
  LIFERAY_API_PASSWORD: str('LIFERAY_API_PASSWORD', ''),
  LIFERAY_COMPANY_ID: num('LIFERAY_COMPANY_ID', 20101),
  LIFERAY_OAUTH_CLIENT_ID: str('LIFERAY_OAUTH_CLIENT_ID', ''),
  LIFERAY_OAUTH_CLIENT_SECRET: str('LIFERAY_OAUTH_CLIENT_SECRET', ''),
  LIFERAY_AUTH_METHOD: str('LIFERAY_AUTH_METHOD', ''),

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
  PERSISTENCE_DB_PATH: str(
    'PERSISTENCE_DB_PATH',
    process.env.NODE_ENV === 'test' ? ':memory:' : './data/workflows.db'
  ),
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
  POLLING_DELAY_MS: num('POLLING_DELAY_MS', 2000, 100), // 2 seconds
  POLLING_RETRIES: num('POLLING_RETRIES', 12, 1), // 1 minute total
  MAX_DELTA_FETCH_RETRIES: num('MAX_DELTA_FETCH_RETRIES', 5, 1),
  RETRY_BACKOFF_MS: num('RETRY_BACKOFF_MS', 1000, 100),
  GRAPHQL_RETRY_ATTEMPTS: num('GRAPHQL_RETRY_ATTEMPTS', 10, 1),
  // New delay for Liferay inter-service sync
  LIFERAY_SYNC_DELAY_MS: num('LIFERAY_SYNC_DELAY_MS', 3000, 0), // 3 seconds
  LIFERAY_API_MAX_RETRIES: num('LIFERAY_API_MAX_RETRIES', 3, 1),
  LIFERAY_MAX_DELETION_ERRORS: num('LIFERAY_MAX_DELETION_ERRORS', 3, 1),
  LIFERAY_MAX_BATCH_ERRORS: num('LIFERAY_MAX_BATCH_ERRORS', 3, 1),

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
  SKU: 'AICA-SKU',
  SPECIFICATION: 'AICA-SPEC',
  SPECIFICATION_CATEGORY: 'AICA-SPEC-CAT',
  WAREHOUSE: 'AICA-WH',
  ADDRESS: 'AICA-ADDR',
  TIER_PRICE: 'AICA-TP',
  ERROR: 'AICA-ERR',
  USER_SEGMENT: 'AICA-SEG',
  PROMOTION: 'AICA-PROMO',
};

const IMAGE_BATCH_ID = crypto.randomUUID();
const PDF_BATCH_ID = crypto.randomUUID();

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
  GENERATION_LIMITS: 'GENERATION-LIMITS',
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

const WORKFLOW_STEPS = {
  DISCOVER: 'discover',
  // Generation Steps
  LOAD_COUNTRIES: 'load-countries',
  LOAD_LANGUAGES: 'load-languages',
  LOAD_METADATA: 'load-metadata',
  GENERATE_ACCOUNT_DATA: 'generate-account-data',
  CREATE_ACCOUNTS: 'create-accounts',
  RESOLVE_ACCOUNT_IDS: 'resolve-account-ids',
  CREATE_POSTAL_ADDRESSES: 'create-addresses',
  SET_ADDRESS_DEFAULTS: 'link-addresses',
  CREATE_WAREHOUSES: 'create-warehouses',
  RESOLVE_WAREHOUSE_IDS: 'resolve-warehouse-ids',
  GENERATE_WAREHOUSE_DATA: 'generate-warehouse-data',
  GENERATE_PRODUCT_DATA: 'generate-product-data',
  ENSURE_SPECIFICATION_CATEGORIES: 'ensure-specification-categories',
  ENSURE_SPECIFICATIONS: 'ensure-specifications',
  ENSURE_OPTIONS: 'ensure-options',
  CREATE_PRODUCTS: 'create-products',
  RESOLVE_PRODUCT_IDS: 'resolve-product-ids',
  LINK_PRODUCT_OPTIONS: 'link-product-options',
  LINK_PRODUCT_CHANNELS: 'link-product-channels',
  LINK_WAREHOUSE_CHANNELS: 'link-warehouse-channels',
  CREATE_PRODUCT_SKUS: 'create-skus',
  RESOLVE_SKU_IDS: 'resolve-sku-ids',
  SYNC_DELAY_PRICING: 'sync-delay-pricing',
  SYNC_DELAY_MEDIA: 'sync-delay-media',
  SYNC_DELAY_ORDERS: 'sync-delay-orders',
  GENERATE_PRICE_LISTS: 'create-price-lists',
  UPDATE_CATALOG_CONFIG: 'update-catalog-config',
  GENERATE_BULK_PRICING: 'create-bulk-pricing',
  GENERATE_TIER_PRICING: 'create-tier-pricing',
  ATTACH_IMAGES: 'create-images',
  ATTACH_PDFS: 'create-pdfs',
  UPDATE_INVENTORY: 'update-inventory',
  GENERATE_ORDER_DATA: 'generate-order-data',
  CREATE_ORDERS: 'create-orders',
  SYNC_DELAY: 'sync-delay',

  // Subflow Steps
  SUBFLOW_ACCOUNTS: 'subflow-accounts',
  SUBFLOW_PRODUCTS: 'subflow-products',
  SUBFLOW_ORDERS: 'subflow-orders',

  // Cleanup/Deletion Steps
  RESET_CATALOG_CONFIG: 'reset-catalog-config',
  DELETE_ORDERS: 'delete-orders',
  DELETE_WAREHOUSES: 'delete-warehouses',
  DELETE_WAREHOUSE_ITEMS: 'delete-warehouse-items',
  DELETE_ACCOUNTS: 'delete-accounts',
  DELETE_PRODUCTS: 'delete-products',
  DELETE_PRODUCT_OPTIONS: 'delete-product-options',
  DELETE_PRODUCT_SPECIFICATIONS: 'delete-product-specifications',
  DELETE_PRICE_LISTS: 'delete-price-lists',
  DELETE_PROMOTIONS: 'delete-promotions',
  DELETE_ACCOUNT_GROUPS: 'delete-account-groups',
  DELETE_SPECIFICATIONS: 'delete-specifications',
  DELETE_OPTIONS: 'delete-options',
  DELETE_OPTION_CATEGORIES: 'delete-option-categories',
  DELETE_PRODUCT_RELATED: 'delete-product-related',
};

module.exports = {
  APP_ERCS,
  EMPTY_PLACEHOLDER,
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
  WORKFLOW_STEPS,
  JOB_TYPES,
};
