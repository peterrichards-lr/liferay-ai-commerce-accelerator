const { lookupConfig } = require('@rotty3000/config-node');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Settings that were supplied and could not be used as supplied.
 *
 * These helpers run while this module is being loaded, and `logger.cjs`
 * requires this file - so nothing here can log, which is why a misconfiguration
 * has always been silent (#934). They are recorded instead, and `server.cjs`
 * reports them once the logger exists.
 *
 * Only a value the operator actually set is recorded. An absent setting taking
 * its default is the normal case and says nothing.
 */
const ENV_WARNINGS = [];

function supplied(raw) {
  return raw !== undefined && raw !== null && raw !== '';
}
// `min` defaults rather than being assumed. `Math.max(n, undefined)` is NaN, so
// a caller that omitted it got NaN for every *valid* value while the default
// path kept working - and a NaN REQUEST_MAX_BYTES meant `contentLength > limit`
// was false for every request, so configuring the size limit removed it. See
// #945.
function num(key, def, min = -Infinity) {
  let raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') raw = lookupConfig(key);
  const n = toNumber(raw);

  if (!Number.isFinite(n)) {
    if (supplied(raw)) {
      ENV_WARNINGS.push(
        `${key} was set to "${raw}", which is not a number. Using ${def}.`
      );
    }
    return def;
  }

  const clamped = Math.max(n, min);

  if (clamped !== n) {
    ENV_WARNINGS.push(
      `${key} was set to ${n}, below the minimum of ${min}. Using ${clamped}.`
    );
  }

  return clamped;
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

  if (supplied(v)) {
    ENV_WARNINGS.push(
      `${key} was set to "${v}", which is not true or false. Using ${def}.`
    );
  }

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
  OAUTH_SERVER_EXTERNAL_REFERENCE_CODE: 'ai-commerce-accelerator-microservice',
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
  AI_API_KEY: str('AI_API_KEY', ''),
  AI_MEDIA_API_KEY: str('AI_MEDIA_API_KEY', ''),
  OPENAI_API_KEY: str('OPENAI_API_KEY', ''),
  GEMINI_API_KEY: str('GEMINI_API_KEY', ''),
  ANTHROPIC_API_KEY: str('ANTHROPIC_API_KEY', ''),

  // Liferay connection
  LIFERAY_API_URL: str('LIFERAY_API_URL', ''),
  // The instance as a browser sees it, which is what a bearer token is
  // verified against and what the health check connects to. Documented in
  // .env.example and read straight from process.env in two places until #933;
  // the default lives here so both read the same one.
  LIFERAY_URL: str('LIFERAY_URL', 'http://localhost:8080'),
  LIFERAY_API_USERNAME: str('LIFERAY_API_USERNAME', ''),
  LIFERAY_API_PASSWORD: str('LIFERAY_API_PASSWORD', ''),
  // Kept deliberately, though nothing reads it. It is the one survivor of the
  // never-wired block removed in #1065, left because a company id is what
  // multi-company support would need and deleting it would throw away the name
  // rather than a line of code. If that support does not arrive, delete it -
  // but as a decision, not as a sweep.
  LIFERAY_COMPANY_ID: num('LIFERAY_COMPANY_ID', 20101),
  LIFERAY_OAUTH_CLIENT_ID: str('LIFERAY_OAUTH_CLIENT_ID', ''),
  LIFERAY_OAUTH_CLIENT_SECRET: str('LIFERAY_OAUTH_CLIENT_SECRET', ''),

  // Where AICA reads its own configuration, when that is not the instance it
  // writes data to. Blank by default, which means "the same instance" - the
  // topology every colocated deployment has. A layer below the request rather
  // than above it, because on a shared deployment ENV is one value for every
  // user of the server, and it exists so a CLI or a scripted run can name a
  // configuration source without putting a client secret in shell history.
  // See #824.
  AICA_CONFIG_SOURCE_URL: str('AICA_CONFIG_SOURCE_URL', ''),
  AICA_CONFIG_SOURCE_CLIENT_ID: str('AICA_CONFIG_SOURCE_CLIENT_ID', ''),
  AICA_CONFIG_SOURCE_CLIENT_SECRET: str('AICA_CONFIG_SOURCE_CLIENT_SECRET', ''),
  // Application base of the search-reindex OSGi module this deployment
  // targets. Left blank by default rather than defaulted here to
  // '/o/search-reindex' - that literal belongs to the SDK's own
  // DEFAULT_REINDEX_BASE_PATH (utils/liferayUtils.cjs resolves the value that
  // actually reaches LiferayRestService.triggerReindex from this and that
  // constant), and AICA keeping a second copy is exactly what #675 removed.
  //
  // Same name the SDK's own ENV layer already falls back to inside
  // triggerReindex, so one value drives both instead of two names that could
  // disagree. See #674, accelerator-sdk#166, SDK PR #168.
  LIFERAY_REINDEX_BASE_PATH: str('LIFERAY_REINDEX_BASE_PATH', ''),

  // Request size ceilings (#887).
  //
  // The general ceiling guards every route. The import needs its own, because
  // a dataset package is the one payload this service legitimately receives at
  // size: a 22-product .aicap with its images and PDFs is 30MB, so the general
  // 10MB ceiling rejected a package this same service had just produced.
  //
  // Raising the general ceiling instead would have removed the guard from
  // every other route to accommodate one. This is deliberately generous rather
  // than unbounded - multer buffers the upload in memory, so an unbounded
  // ceiling is an out-of-memory waiting for a big enough file.
  REQUEST_MAX_BYTES: num('REQUEST_MAX_BYTES', 10 * 1024 * 1024),
  IMPORT_MAX_BYTES: num('IMPORT_MAX_BYTES', 256 * 1024 * 1024),

  // Cache sizing. These were read as `ENV.*` by `cacheService` and declared
  // nowhere, so they were permanently undefined and the service silently took
  // the fallback beside each read. The defaults below are those fallbacks, so
  // an unset deployment behaves exactly as before - what changes is that
  // setting one now does something (#1068).
  //
  // Note these are NOT the values in the DEFAULTS object above, which carries a
  // different CACHE_MAX_SIZE and CACHE_DEFAULT_TTL. Those are unrelated to this
  // service and were never what it used; matching them here would have changed
  // behaviour rather than preserved it.
  CACHE_MAX_SIZE: num('CACHE_MAX_SIZE', 10000, 100),
  CACHE_DEFAULT_TTL: num('CACHE_DEFAULT_TTL', 3600000, 1000),
  CACHE_CLEANUP_INTERVAL: num('CACHE_CLEANUP_INTERVAL', 60000, 5000),

  // How long a configuration object stays cached. The default is the intent
  // already recorded in DEFAULTS.CONFIG_DEFAULT_TTL.
  //
  // Only raising it has an effect today. `cacheService.set` computes
  // `Math.max(this.defaultTTL, ttl)`, so any per-entry TTL below
  // CACHE_DEFAULT_TTL is floored away - which is why declaring this is
  // behaviour-neutral rather than a change. If that floor is ever removed,
  // this default becomes live and the config cache drops from an hour to six
  // minutes; that would be the moment to decide whether six minutes is right.
  CONFIG_CACHE_TTL: num('CONFIG_CACHE_TTL', 360000, 1000),

  // Prompt templates. PROMPTS_DIR defaults to empty on purpose: `promptService`
  // resolves `envDir || cfgDir || 'prompts'`, so a non-empty default here would
  // shadow the `promptsDir` an operator set in ai-config.
  PROMPTS_DIR: str('PROMPTS_DIR', ''),
  PROMPT_CACHE_TTL: num('PROMPT_CACHE_TTL', 10 * 60 * 1000, 1),
  PROMPT_CACHE_DISABLED: bool('PROMPT_CACHE_DISABLED', false),

  // Internal microservice configuration.
  //
  // The listener's host and port are NOT declared here. `server.cjs` resolves
  // them through `lookupConfig('server.host')` / `lookupConfig('server.port')`,
  // and config-node's env-var provider mangles those keys to SERVER_HOST and
  // SERVER_PORT - so the environment variables still work, through that path.
  // Declaring them here as well created a second, unread copy whose default
  // (3001) disagreed with the one server.cjs actually fell back to (3000).
  // `MICROSERVICE_URL` was likewise unread; the CLI's own knob is
  // AICA_MICROSERVICE_URL, in `scripts/aica-cli.cjs`.
  LOGGER_LEVEL: str('logger.level', 'info'),
  LOGGER_PRETTY: bool('logger.pretty', false),
  // Read here, the same way PERSISTENCE_DB_PATH and MEDIA_ARCHIVE_PATH are,
  // so tests/setup.mjs can redirect it before utils/logger.cjs resolves
  // logsDir at require time. A suite run wrote 37 fixture "reads as a
  // fraction" warnings and real XSS-probe/signature-rejection lines into this
  // same file while a live generate run was mid-flight, indistinguishable
  // from that run's own diagnostics (#794).
  LOGS_DIR: str('LOGS_DIR', path.join(__dirname, '..', 'logs')),
  NODE_ENV: str('NODE_ENV', 'development'),
  SERVICE_NAME: str('SERVICE_NAME', 'liferay-ai-data-microservice'),
  SERVICE_VERSION: str('SERVICE_VERSION', '1.0.0'),
  PERSISTENCE_DB_PATH: str(
    'PERSISTENCE_DB_PATH',
    process.env.NODE_ENV === 'test' ? ':memory:' : './data/workflows.db'
  ),
  // Media on disk is no longer optional, because it is how a package is built.
  //
  // It began as a recovery aid with no consumer, so it shipped off (#848).
  // Both producers now stage through it - a generation run as it uploads, an
  // extract as it pulls from the instance - and `GET /export-commerce-bundle`
  // builds the package by reading it back (#896). A switch that stopped the
  // writing would be a switch that silently produced empty packages.
  //
  // What remains is how long a directory stays, and that is what these three
  // answer. `MEDIA_ARCHIVE_RETAIN` governs a directory staged purely to build
  // a package: with it off, the staging directory goes as soon as the package
  // it produced has been sent. A run's own media is not staging - it is the
  // run's - so it lives under the age and session-count prune below, and under
  // the orphan sweep once its session is gone (#898).
  MEDIA_ARCHIVE_RETAIN: bool(
    'MEDIA_ARCHIVE_RETAIN',
    // The name this setting had when it meant something else. Honoured so a
    // deployment carrying MEDIA_ARCHIVE_ENABLED=false gets what it asked for -
    // the least media this service can keep - rather than silently flipping.
    bool('MEDIA_ARCHIVE_ENABLED', true)
  ),
  // Beside workflows.db, and for exactly the reason it is there: `./data` is
  // inside the repository, next to build/ and dist/, which is where state gets
  // destroyed by ordinary tooling (#868, #869). A package built from media
  // that a `gradle clean` can remove is a promotion waiting to arrive without
  // its pictures (#899).
  MEDIA_ARCHIVE_PATH: str(
    'MEDIA_ARCHIVE_PATH',
    path.join(os.homedir(), '.aica', 'media')
  ),
  // Where it used to be, so a checkout that ran with the old default can be
  // moved rather than quietly ignored.
  MEDIA_ARCHIVE_LEGACY_PATH: './data/media',
  // Logs at least rotate. Binaries do not, so the retention policy is the
  // whole answer to "is this a disk leak". Three days keeps a run recoverable
  // across a weekend and no longer; the session cap behind it is what stops a
  // single busy day filling the volume well inside that window.
  MEDIA_ARCHIVE_RETENTION_HOURS: num('MEDIA_ARCHIVE_RETENTION_HOURS', 72, 1),
  MEDIA_ARCHIVE_MAX_SESSIONS: num('MEDIA_ARCHIVE_MAX_SESSIONS', 10, 1),

  // AI request settings, as the ENV layer of a four-step chain resolved in
  // aiService.getRuntimeAIConfig: request body, then the target's ai-config
  // object, then these, then a hardcoded default.
  //
  // The ENV layer exists because the ai-config object lives in the Liferay the
  // client extensions are deployed to, while a run may target a different
  // instance entirely - in which case aiCfg is empty and every AI setting
  // silently fell back to its hardcoded default. Null here means "not set", so
  // it does not shadow the target's own configuration when there is one.
  AI_REQUEST_TIMEOUT_MS: num('AI_REQUEST_TIMEOUT_MS', null, 1000),
  AI_CHUNK_SIZE_PRODUCT: num('AI_CHUNK_SIZE_PRODUCT', null, 1),
  AI_CHUNK_SIZE_ORDER: num('AI_CHUNK_SIZE_ORDER', null, 1),
  AI_CHUNK_SIZE_ACCOUNT: num('AI_CHUNK_SIZE_ACCOUNT', null, 1),
  AI_CHUNK_SIZE_WAREHOUSE: num('AI_CHUNK_SIZE_WAREHOUSE', null, 1),
  AI_CHUNK_SIZE_PRICING: num('AI_CHUNK_SIZE_PRICING', null, 1),
  // Null rather than false, for the same reason as the settings above: it is
  // the ENV layer of the chain, and `false` would be indistinguishable from a
  // deliberate opt-out and would shadow the target's own configuration.
  AI_NAME_FIRST_PRODUCTS: bool('AI_NAME_FIRST_PRODUCTS', null),
  // The pre-flight guardrail: an estimated prompt above this many tokens is
  // refused before the request is sent, and the refusal names the number.
  //
  // Read here rather than from `process.env` at the point of use, so that a
  // deployment supplying it through Liferay's own configuration layer is
  // honoured - `lookupConfig` is consulted by these helpers and was not by the
  // original `parseInt(process.env...)`. A real minimum, because a limit of
  // zero would refuse every prompt including the ones this exists to permit.
  // See #934.
  AICA_MAX_TOKEN_LIMIT: num('AICA_MAX_TOKEN_LIMIT', 15000, 1),
  // The escape hatch the refusal message tells the operator to use. It is the
  // remedy for the setting above, so it was equally undiscoverable while both
  // lived only in `process.env`.
  ALLOW_LARGE_PROMPTS: bool('ALLOW_LARGE_PROMPTS', false),
  // New delay for Liferay inter-service sync
  LIFERAY_SYNC_DELAY_MS: num('LIFERAY_SYNC_DELAY_MS', 3000, 0), // 3 seconds
  // Where Liferay mounts the DXP config tree. Set by the liferay/node-runner
  // base image rather than by our LCP.json, and consumed by config-node
  // through `config.node.config.trees` in application.json - declared here so
  // the readiness watcher can read the same directory rather than assume the
  // LXC convention. See #1103.
  LIFERAY_ROUTES_DXP: str(
    'LIFERAY_ROUTES_DXP',
    '/etc/liferay/lxc/dxp-metadata'
  ),
  // How long to keep watching for that tree. Generous by default: it is
  // written when Liferay's main servlet is first hit, which is a stack
  // bring-up event rather than a fixed delay.
  LXC_CONFIG_WAIT_MS: num('LXC_CONFIG_WAIT_MS', 300000, 0),
  LXC_CONFIG_POLL_MS: num('LXC_CONFIG_POLL_MS', 1000, 100),
  // Read directly rather than through config-node's `lookupConfig`, which is
  // the whole point: its provider order puts config trees (6000) ahead of
  // individual environment variables (7000), so a tree recording Liferay's
  // local listener buries the correct host that LDM sets here. Measured in run
  // 36014266810 - the tree said `localhost`, this said `aica-e2e.demo`, and
  // the tree won. See #1137.
  LIFERAY_LXC_DXP_MAIN_DOMAIN: str('LIFERAY_LXC_DXP_MAIN_DOMAIN', ''),
  LIFERAY_LXC_DXP_SERVER_PROTOCOL: str(
    'LIFERAY_LXC_DXP_SERVER_PROTOCOL',
    'https'
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
  // Attachments are the one write that had no reference of its own, so a
  // second attempt attached the same file again (#1040).
  PRODUCT_IMAGE: 'AICA-IMG',
  PRODUCT_ATTACHMENT: 'AICA-ATT',
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
  WARNING: 'WARNING',

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
  ENSURE_CATEGORIES: 'ensure-categories',
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

  // Promotions & User Segments Subflow Steps
  GENERATE_PROMO_DATA: 'generate-promo-data',
  CREATE_USER_SEGMENTS: 'create-user-segments',
  CREATE_PROMOTIONS: 'create-promotions',

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
  ENV_WARNINGS,
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
