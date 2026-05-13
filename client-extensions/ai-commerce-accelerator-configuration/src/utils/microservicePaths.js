const API_VERSION = 'v1';

const BASE_PATH = `/api/${API_VERSION}`;
const CONFIG_PATH = `${BASE_PATH}/config`;
const GENERATE_PATH = `${BASE_PATH}/generate`;

const DELETE_COMMERCE_DATA = `${BASE_PATH}/delete-commerce-data`;
const DELETE_SELECTED_COMMERCE_DATA = `${BASE_PATH}/delete-selected-commerce-data`;
const EXPORT_COMMERCE_DATA = `${BASE_PATH}/export-commerce-data`;
const GET_CATALOGS = `${BASE_PATH}/get-catalogs`;
const GET_CHANNELS = `${BASE_PATH}/get-channels`;
const GET_CURRENCIES = `${BASE_PATH}/get-currencies`;
const GET_LANGUAGES = `${BASE_PATH}/get-languages`;
const IMPORT_COMMERCE_DATA = `${BASE_PATH}/import-commerce-data`;
const TEST_CONNECTION = `${BASE_PATH}/test-connection`;

const AI_MODEL_OPTIONS = `${CONFIG_PATH}/ai-model-options`;
const AI_CONFIG = `${CONFIG_PATH}/ai`;
const BATCH_SIZES = `${CONFIG_PATH}/batch-sizes`;
const CONFIG_GENERATION_LIMITS = `${CONFIG_PATH}/generation-limits`;
const CONFIG_HEALTH = `${CONFIG_PATH}/health`;
const HEALTH = `${BASE_PATH}/health`;
const HEALTH_DETAILED = `${BASE_PATH}/health/detailed`;
const GET_CATEGORIES = `${CONFIG_PATH}/categories`;

const WORKFLOW = 'workflow';
const GENERATE_WORKFLOW = `${GENERATE_PATH}/${WORKFLOW}`;

const WORKFLOW_SESSIONS = `${BASE_PATH}/workflows/sessions`;
const COMPLETED_WORKFLOW_SESSIONS = `${BASE_PATH}/workflows/sessions/completed`;
const WORKFLOW_KPIS = `${BASE_PATH}/workflows/kpis`;
const WORKFLOW_BATCHES = `${BASE_PATH}/workflows/batches/:sessionId`;
const WORKFLOW_STATUS = `${BASE_PATH}/workflows/sessions/:sessionId/status`;
const WORKFLOW_EVENTS = `${BASE_PATH}/workflows/sessions/:sessionId/events`;
const WORKFLOW_CLEAR_ALL = `${BASE_PATH}/workflows/clear-all`;

const LOGS_DOWNLOAD = `${BASE_PATH}/logs/download`;
const LOGS_CLEAR = `${BASE_PATH}/logs`;
const LOGS_CYCLE = `${BASE_PATH}/logs/cycle`;
const LOGS_SETTINGS = `${BASE_PATH}/logs/settings`;
const LOGS_SESSION = `${BASE_PATH}/logs/session/:sessionId`;

const MEDIA_PLACEHOLDERS = `${BASE_PATH}/media/placeholders`;
const MEDIA_PLACEHOLDER_BASE64 = `${BASE_PATH}/media/placeholders/:filename/base64`;

export {
  DELETE_COMMERCE_DATA,
  DELETE_SELECTED_COMMERCE_DATA,
  EXPORT_COMMERCE_DATA,
  GET_CATALOGS,
  GET_CATEGORIES,
  GET_CHANNELS,
  GET_CURRENCIES,
  GET_LANGUAGES,
  IMPORT_COMMERCE_DATA,
  TEST_CONNECTION,
  AI_MODEL_OPTIONS,
  AI_CONFIG,
  BATCH_SIZES,
  CONFIG_GENERATION_LIMITS,
  CONFIG_HEALTH,
  HEALTH,
  HEALTH_DETAILED,
  GENERATE_WORKFLOW,
  WORKFLOW_SESSIONS,
  COMPLETED_WORKFLOW_SESSIONS,
  WORKFLOW_KPIS,
  WORKFLOW_BATCHES,
  WORKFLOW_STATUS,
  WORKFLOW_EVENTS,
  WORKFLOW_CLEAR_ALL,
  LOGS_DOWNLOAD,
  LOGS_CLEAR,
  LOGS_CYCLE,
  LOGS_SETTINGS,
  LOGS_SESSION,
  MEDIA_PLACEHOLDERS,
  MEDIA_PLACEHOLDER_BASE64,
};
