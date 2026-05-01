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
const BATCH_SIZES = `${CONFIG_PATH}/batch-sizes`;
const GET_CATEGORIES = `${CONFIG_PATH}/categories`;

const WORKFLOW = 'workflow';
const GENERATE_WORKFLOW = `${GENERATE_PATH}/${WORKFLOW}`;

const WORKFLOW_SESSIONS = `${BASE_PATH}/workflows/sessions`;
const WORKFLOW_BATCHES = `${BASE_PATH}/workflows/batches/:sessionId`;
const WORKFLOW_STATUS = `${BASE_PATH}/workflows/sessions/:sessionId/status`;

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
  BATCH_SIZES,
  GENERATE_WORKFLOW,
  WORKFLOW_SESSIONS,
  WORKFLOW_BATCHES,
  WORKFLOW_STATUS,
};
