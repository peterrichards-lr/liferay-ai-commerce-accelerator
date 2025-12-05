const { tryParseJSON, createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const fs = require('fs');
const path = require('path');

const AI_CONFIG_CACHE_KEY = 'AI_CONFIG_KEY';
const AI_CONFIG_KEY = 'ai-config';

const AI_PROMPT_CACHE_KEY_PREFIX = 'AI_PROMPT_';
const AI_PROMPT_CONFIG_KEY_PREFIX = 'ai-prompt-';

const AI_CATEGORIES_CACHE_KEY = 'AI_CATEGORIES_KEY';
const AI_CATEGORIES_CONFIG_KEY = 'ai-categories';

const AI_SCHEMA_CACHE_KEY_PREFIX = 'AI_SCHEMA_';
const AI_SCHEMA_CONFIG_KEY_PREFIX = 'ai-schema-';

const BATCH_POLLING_CONFIG_CACHE_KEY = 'BATCH_POLLING_CONFIG_KEY';
const BATCH_POLLING_CONFIG_KEY = 'batch-polling-config';

const CACHE_CONFIG_CACHE_KEY = 'CACHE_CONFIG_KEY';
const CACHE_CONFIG_KEY = 'cache-config';

const DEFAULT_IMAGE_CACHE_KEY = 'DEFAULT_IMAGE_KEY';
const DEFAULT_IMAGE_CONFIG_KEY = 'default-image';

const DEFAULT_PDF_CACHE_KEY = 'DEFAULT_PDF_KEY';
const DEFAULT_PDF_CONFIG_KEY = 'default-pdf';

const OAUTH_CONFIG_CACHE_KEY = 'OAUTH_CONFIG_KEY';
const OAUTH_CONFIG_KEY = 'oauth-config';

const OBJECT_STORAGE_CONFIG_CACHE_KEY = 'OBJECT_STORAGE_CONFIG_KEY';
const OBJECT_STORAGE_CONFIG_KEY = 'object-storage-config';

const OPENAPI_CACHE_KEY = 'OPENAI_API_KEY';
const OPENAI_CONFIG_KEY = 'open-ai-key';

const QUEUE_CONFIG_CACHE_KEY = 'QUEUE_CONFIG_KEY';
const QUEUE_CONFIG_KEY = 'queue-config';

const WS_CONFIG_CACHE_KEY = 'WS_CONFIG_KEY';
const WS_CONFIG_KEY = 'ws-config';

class ConfigService {
  constructor(ctx) {
    this.cache = ctx.cache;
    this.logger = ctx.logger;
  }

  setLiferayService(liferay) {
    this.liferay = liferay;
  }

  _requireLiferay() {
    if (!this.liferay) throw new Error('Liferay service not set');
    return this.liferay;
  }

  getConfigTTL() {
    const { ENV } = require('../utils/constants.cjs');
    return ENV.CONFIG_CACHE_TTL;
  }

  getConfigCached(cacheKey) {
    const cached = this.cache.get(cacheKey);
    return cached ?? null;
  }

  async getConfig(requestConfig, cacheKey, configKey) {
    const cache = this.cache;
    const logger = this.logger;
    const liferay = this._requireLiferay();

    if (!requestConfig) {
      const erc = requestConfig?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(new Error('Missing requestConfig'), {
        operation: 'config-get',
        errorReference: erc,
        message: 'requestConfig was not provided to ConfigService.getConfig',
        configKey,
      });
      throw new Error('OAuth configuration required (requestConfig missing)');
    }

    const cached = cache.get(cacheKey);
    if (cached !== undefined && cached !== null) {
      return cached;
    }

    let response;
    try {
      response = await liferay.getConfig(requestConfig, configKey);
    } catch (err) {
      const erc = err?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(err, {
        operation: 'liferay-get-config',
        errorReference: erc,
        message: `Failed to read config for key "${configKey}"`,
      });
      throw err;
    }

    if (response?.items && response.items.length > 0) {
      const rawVal = response.items[0].configValue;
      const parsedValue =
        typeof rawVal === 'string' ? tryParseJSON(rawVal) : rawVal;

      cache.set(cacheKey, parsedValue, this.getConfigTTL());
      return parsedValue;
    }

    return null;
  }

  async getAISchema(requestConfig, schemaName) {
    const cacheKey = `${AI_SCHEMA_CACHE_KEY_PREFIX}${schemaName}`;
    const configKey = `${AI_SCHEMA_CONFIG_KEY_PREFIX}${schemaName}`;

    const cached = this.getConfigCached(cacheKey);
    if (cached) {
      return cached;
    }

    const remoteSchema = await this.getConfig(
      requestConfig,
      cacheKey,
      configKey
    );

    if (remoteSchema) {
      return remoteSchema;
    }

    const defaultSchemaPath = path.join(
      __dirname,
      '../ai-schemas',
      `${schemaName}.json`
    );

    try {
      const defaultSchema = fs.readFileSync(defaultSchemaPath, 'utf8');
      const parsedSchema = JSON.parse(defaultSchema);
      this.cache.set(cacheKey, parsedSchema, this.getConfigTTL());
      return parsedSchema;
    } catch (error) {
      this.logger.error(`Failed to read default AI schema: ${schemaName}`, {
        error,
      });
      return null;
    }
  }

  async getAIPrompt(requestConfig, promptName) {
    const cacheKey = `${AI_PROMPT_CACHE_KEY_PREFIX}${promptName}`;
    const configKey = `${AI_PROMPT_CONFIG_KEY_PREFIX}${promptName}`;

    const cached = this.getConfigCached(cacheKey);
    if (cached) {
      return cached;
    }

    const remotePrompt = await this.getConfig(
      requestConfig,
      cacheKey,
      configKey
    );

    return remotePrompt || null;
  }

  async getAIPromptsConfig(requestConfig) {
    const promptNames = ['account', 'order', 'pdf', 'pricing', 'product'];
    const prompts = {};

    for (const name of promptNames) {
      prompts[name] = await this.getAIPrompt(requestConfig, name);
    }
    return prompts;
  }

  async getCategories(requestConfig) {
    const cacheKey = AI_CATEGORIES_CACHE_KEY;
    const configKey = AI_CATEGORIES_CONFIG_KEY;

    const cached = this.getConfigCached(cacheKey);
    if (cached) {
      return cached;
    }

    const remoteCategories = await this.getConfig(
      requestConfig,
      cacheKey,
      configKey
    );

    if (remoteCategories) {
      return remoteCategories;
    }


    const defaultCategoriesPath = path.join(
      __dirname,
      '../../ai-commerce-accelerator-frontend/src/config',
      'categories.json'
    );

    try {
      const defaultCategories = fs.readFileSync(defaultCategoriesPath, 'utf8');
      const parsedCategories = JSON.parse(defaultCategories);
      this.cache.set(cacheKey, parsedCategories, this.getConfigTTL());
      return parsedCategories;
    } catch (error) {
      this.logger.warn(`Failed to read default categories from frontend config: ${error.message}`);
      return []; // Return empty array on error
    }
  }

  getCategoriesCached() {
    return this.getConfigCached(AI_CATEGORIES_CACHE_KEY);
  }
  
  async getDefaultImage(requestConfig) {
    const logger = this.logger;

    try {
      return await this.getConfig(
        requestConfig,
        DEFAULT_IMAGE_CACHE_KEY,
        DEFAULT_IMAGE_CONFIG_KEY
      );
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-default-image',
        errorReference: erc,
        message: 'Failed to get default image from Liferay Object',
      });
      throw new Error('Default image not configured.');
    }
  }

  getDefaultImageCached() {
    return this.getConfigCached(DEFAULT_IMAGE_CACHE_KEY);
  }

  async getDefaultPdf(requestConfig) {
    const logger = this.logger;
    try {
      return await this.getConfig(
        requestConfig,
        DEFAULT_PDF_CACHE_KEY,
        DEFAULT_PDF_CONFIG_KEY
      );
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-default-pdf',
        errorReference: erc,
        message: 'Failed to get default PDF from Liferay Object',
      });
      throw new Error('Default PDF not configured.');
    }
  }

  getDefaultPdfCached() {
    return this.getConfigCached(DEFAULT_PDF_CACHE_KEY);
  }

  async getOpenAIKey(requestConfig) {
    const logger = this.logger;
    try {
      return await this.getConfig(
        requestConfig,
        OPENAPI_CACHE_KEY,
        OPENAI_CONFIG_KEY
      );
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-openai-key',
        errorReference: erc,
        message: 'Failed to get OpenAI key from Liferay Object',
      });
      throw new Error('OpenAI API key not configured.');
    }
  }

  getOpenAIKeyCached() {
    return this.getConfigCached(OPENAPI_CACHE_KEY);
  }

  async _getConfigWithFallback(
    requestConfig,
    cacheKey,
    configKey,
    operation,
    errorMessage
  ) {
    const logger = this.logger;
    try {
      const cfg = await this.getConfig(requestConfig, cacheKey, configKey);
      return cfg || {};
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: operation,
        errorReference: erc,
        message: errorMessage,
      });
      return {};
    }
  }

  async getCacheConfig(requestConfig) {
    return this._getConfigWithFallback(
      requestConfig,
      CACHE_CONFIG_CACHE_KEY,
      CACHE_CONFIG_KEY,
      'get-cache-config',
      'Failed to get cache configuration'
    );
  }

  getCacheConfigCached() {
    return this.getConfigCached(CACHE_CONFIG_CACHE_KEY) || {};
  }

  async getBatchPollingConfig(requestConfig) {
    return this._getConfigWithFallback(
      requestConfig,
      BATCH_POLLING_CONFIG_CACHE_KEY,
      BATCH_POLLING_CONFIG_KEY,
      'get-batch-polling-config',
      'Failed to get batch polling configuration'
    );
  }

  getBatchPollingConfigCached() {
    return this.getConfigCached(BATCH_POLLING_CONFIG_CACHE_KEY) || {};
  }

  async getQueueConfig(requestConfig) {
    return this._getConfigWithFallback(
      requestConfig,
      QUEUE_CONFIG_CACHE_KEY,
      QUEUE_CONFIG_KEY,
      'get-queue-config',
      'Failed to get queue configuration'
    );
  }

  getQueueConfigCached() {
    return this.getConfigCached(QUEUE_CONFIG_CACHE_KEY) || {};
  }


  async getAIConfig(requestConfig) {
    const cache = this.cache;
    const logger = this.logger;
    const liferay = this._requireLiferay();
    const cached = cache.get(AI_CONFIG_CACHE_KEY);
    if (cached) return cached;

    try {
      const resp = await liferay.getConfig(requestConfig, AI_CONFIG_KEY);
      if (resp?.items?.length) {
        const raw = resp.items[0].configValue;
        const parsed = typeof raw === 'string' ? tryParseJSON(raw, {}) : raw;
        cache.set(AI_CONFIG_CACHE_KEY, parsed, this.getConfigTTL());
        return parsed;
      }
      return null;
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-ai-config',
        errorReference: erc,
        message: 'Failed to get AI configuration',
      });
      return null;
    }
  }

  getAIConfigCached() {
    const cache = this.cache;
    return cache.get(AI_CONFIG_CACHE_KEY) || null;
  }



  async getOAuthConfig(requestConfig) {
    return this._getConfigWithFallback(
      requestConfig,
      OAUTH_CONFIG_CACHE_KEY,
      OAUTH_CONFIG_KEY,
      'get-oauth-config',
      'Failed to load OAuth config:'
    );
  }

  getOAuthConfigCached() {
    const cache = this.cache;
    return cache.get(OAUTH_CONFIG_CACHE_KEY) || {};
  }

  async getObjectStorageConfig(requestConfig) {
    return this._getConfigWithFallback(
      requestConfig,
      OBJECT_STORAGE_CONFIG_CACHE_KEY,
      OBJECT_STORAGE_CONFIG_KEY,
      'get-object-storage-config',
      'Failed to load Object Storage config:'
    );
  }

  getObjectStorageConfigCached() {
    const cache = this.cache;
    return cache.get(OBJECT_STORAGE_CONFIG_CACHE_KEY) || {};
  }

  async getWSConfig(requestConfig) {
    return this._getConfigWithFallback(
      requestConfig,
      WS_CONFIG_CACHE_KEY,
      WS_CONFIG_KEY,
      'get-ws-config',
      'Failed to get WebSocket configuration'
    );
  }

  getWSConfigCached() {
    return this.getConfigCached(WS_CONFIG_CACHE_KEY) || {};
  }

  clearCache() {
    const cache = this.cache;

    cache?.clear?.();
  }
}

module.exports = ConfigService;
