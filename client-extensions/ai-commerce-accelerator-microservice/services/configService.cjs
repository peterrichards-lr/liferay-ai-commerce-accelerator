const { isJSON, tryParseJSON, createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

const AI_CONFIG_CACHE_KEY = 'AI_CONFIG_KEY';
const AI_CONFIG_KEY = 'ai-config';

const AI_PROMPTS_CONFIG_CACHE_KEY = 'AI_PROMPTS_CONFIG_KEY';
const AI_PROMPTS_CONFIG_KEY = 'ai-prompts-config';

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
    this.ctx = ctx;
  }

  _ensureRequestConfig(requestConfig) {
    if (
      !requestConfig ||
      !requestConfig.liferayUrl ||
      !requestConfig.clientId ||
      !requestConfig.clientSecret
    ) {
      throw new Error(
        'OAuth configuration required: liferayUrl, clientId, and clientSecret must be provided'
      );
    }
  }

  _safeParseConfigValue(raw) {
    if (raw == null) return {};
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
      if (isJSON(raw)) {
        const parsed = tryParseJSON(raw, null);
        if (parsed && typeof parsed === 'object') return parsed;
      }
      return raw;
    }
    return raw;
  }

  async _getAndCache(requestConfig, cacheKey, liferayKey, { allowNull } = {}) {
    const { cache, liferay } = this.ctx;

    this._ensureRequestConfig(requestConfig);

    const cached = cache.get(cacheKey);
    if (cached) return cached.value;

    const response = await liferay.getConfig(requestConfig, liferayKey);

    if (response?.items && response.items.length > 0) {
      const rawValue = response.items[0].configValue;
      const parsedValue = this._safeParseConfigValue(rawValue);

      cache.set(cacheKey, { value: parsedValue, timestamp: Date.now() });
      return parsedValue;
    }

    return allowNull ? null : {};
  }

  _getCached(cacheKey, fallback = {}) {
    const { cache } = this.ctx;
    const cached = cache.get(cacheKey);
    return cached ? cached.value : fallback;
  }

  async getDefaultImage(requestConfig) {
    const { logger } = this.ctx;
    try {
      return await this._getAndCache(
        requestConfig,
        DEFAULT_IMAGE_CACHE_KEY,
        DEFAULT_IMAGE_CONFIG_KEY,
        { allowNull: false }
      );
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get default image from Liferay Object', {
        operation: 'get-default-image',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      throw Object.assign(new Error('Default image not configured.'), {
        errorReference,
      });
    }
  }

  getDefaultImageCached() {
    return this._getCached(DEFAULT_IMAGE_CACHE_KEY, {});
  }

  async getDefaultPdf(requestConfig) {
    const { logger } = this.ctx;
    try {
      return await this._getAndCache(
        requestConfig,
        DEFAULT_PDF_CACHE_KEY,
        DEFAULT_PDF_CONFIG_KEY,
        { allowNull: false }
      );
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get default PDF from Liferay Object', {
        operation: 'get-default-pdf',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      throw Object.assign(new Error('Default PDF not configured.'), {
        errorReference,
      });
    }
  }

  getDefaultPdfCached() {
    return this._getCached(DEFAULT_PDF_CACHE_KEY, {});
  }

  async getOpenAIKey(requestConfig) {
    const { logger } = this.ctx;
    try {
      const cfg = await this._getAndCache(
        requestConfig,
        OPENAPI_CACHE_KEY,
        OPENAI_CONFIG_KEY,
        { allowNull: false }
      );
      return cfg;
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get OpenAI key from Liferay Object', {
        operation: 'get-openai-key',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      throw Object.assign(new Error('OpenAI API key not configured.'), {
        errorReference,
      });
    }
  }

  getOpenAIKeyCached() {
    return this._getCached(OPENAPI_CACHE_KEY, {});
  }

  async getCacheConfig(requestConfig) {
    const { logger } = this.ctx;
    try {
      const cfg = await this._getAndCache(
        requestConfig,
        CACHE_CONFIG_CACHE_KEY,
        CACHE_CONFIG_KEY,
        { allowNull: false }
      );
      return cfg || {};
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get cache configuration', {
        operation: 'get-cache-config',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      return {};
    }
  }

  getCacheConfigCached() {
    return this._getCached(CACHE_CONFIG_CACHE_KEY, {});
  }

  async getBatchPollingConfig(requestConfig) {
    const { logger } = this.ctx;
    try {
      const cfg = await this._getAndCache(
        requestConfig,
        BATCH_POLLING_CONFIG_CACHE_KEY,
        BATCH_POLLING_CONFIG_KEY,
        { allowNull: false }
      );
      return cfg || {};
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get batch polling configuration', {
        operation: 'get-batch-polling-config',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      return {};
    }
  }

  getBatchPollingConfigCached() {
    return this._getCached(BATCH_POLLING_CONFIG_CACHE_KEY, {});
  }

  async getQueueConfig(requestConfig) {
    const { logger } = this.ctx;
    try {
      const cfg = await this._getAndCache(
        requestConfig,
        QUEUE_CONFIG_CACHE_KEY,
        QUEUE_CONFIG_KEY,
        { allowNull: false }
      );
      return cfg || {};
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get queue configuration', {
        operation: 'get-queue-config',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      return {};
    }
  }

  getQueueConfigCached() {
    return this._getCached(QUEUE_CONFIG_CACHE_KEY, {});
  }

  async getAIConfig(requestConfig) {
    const { cache, liferay, logger } = this.ctx;

    this._ensureRequestConfig(requestConfig);

    const cached = cache.get(AI_CONFIG_CACHE_KEY);
    if (cached) return cached;

    try {
      const resp = await liferay.getConfig(requestConfig, AI_CONFIG_KEY);
      if (resp?.items?.length) {
        const raw = resp.items[0].configValue;
        const parsed = this._safeParseConfigValue(raw);
        cache.set(AI_CONFIG_CACHE_KEY, parsed, this.getConfigTTL());
        return parsed;
      }
      return null;
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get AI configuration', {
        operation: 'get-ai-config',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      throw Object.assign(new Error('AI configuration not available'), {
        errorReference,
      });
    }
  }

  getAIConfigCached() {
    const { cache } = this.ctx;
    return cache.get(AI_CONFIG_CACHE_KEY) || null;
  }

  async getAIPromptsConfig(requestConfig) {
    const { cache, liferay, logger } = this.ctx;

    this._ensureRequestConfig(requestConfig);

    const cached = cache.get(AI_PROMPTS_CONFIG_CACHE_KEY);
    if (cached) return cached;

    try {
      const resp = await liferay.getConfig(
        requestConfig,
        AI_PROMPTS_CONFIG_KEY
      );
      if (resp?.items?.length) {
        const raw = resp.items[0].configValue;
        const parsed = this._safeParseConfigValue(raw);
        cache.set(AI_PROMPTS_CONFIG_CACHE_KEY, parsed, this.getConfigTTL());
        return parsed;
      }
      return null;
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get AI prompts configuration', {
        operation: 'get-ai-prompts-config',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      throw Object.assign(new Error('AI prompts configuration not available'), {
        errorReference,
      });
    }
  }

  getAIPromptsConfigCached() {
    const { cache } = this.ctx;
    return cache.get(AI_PROMPTS_CONFIG_CACHE_KEY) || null;
  }

  async getOAuthConfig(requestConfig) {
    const { cache, liferay, logger } = this.ctx;

    this._ensureRequestConfig(requestConfig);

    const cached = cache.get(OAUTH_CONFIG_CACHE_KEY);
    if (cached) return cached;

    try {
      const response = await liferay.getConfig(requestConfig, OAUTH_CONFIG_KEY);
      if (response?.items && response.items.length > 0) {
        const raw = response.items[0].configValue || '{}';
        const parsed =
          typeof raw === 'string' ? tryParseJSON(raw, {}) : raw || {};
        cache.set(OAUTH_CONFIG_CACHE_KEY, parsed, this.getConfigTTL());
        return parsed;
      }
      return {};
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.('Failed to load OAuth config', {
        operation: 'get-oauth-config',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      return {};
    }
  }

  getOAuthConfigCached() {
    const { cache } = this.ctx;
    return cache.get(OAUTH_CONFIG_CACHE_KEY) || {};
  }

  async getObjectStorageConfig(requestConfig) {
    const { cache, liferay, logger } = this.ctx;

    this._ensureRequestConfig(requestConfig);

    const cached = cache.get(OBJECT_STORAGE_CONFIG_CACHE_KEY);
    if (cached) return cached;

    try {
      const response = await liferay.getConfig(
        requestConfig,
        OBJECT_STORAGE_CONFIG_KEY
      );
      if (response?.items && response.items.length > 0) {
        const raw = response.items[0].configValue || '{}';
        const parsed =
          typeof raw === 'string' ? tryParseJSON(raw, {}) : raw || {};
        cache.set(OBJECT_STORAGE_CONFIG_CACHE_KEY, parsed, this.getConfigTTL());
        return parsed;
      }
      return {};
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.('Failed to load Object Storage config', {
        operation: 'get-object-storage-config',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      return {};
    }
  }

  getObjectStorageConfigCached() {
    const { cache } = this.ctx;
    return cache.get(OBJECT_STORAGE_CONFIG_CACHE_KEY) || {};
  }

  async getWSConfig(requestConfig) {
    const { logger } = this.ctx;
    try {
      const cfg = await this._getAndCache(
        requestConfig,
        WS_CONFIG_CACHE_KEY,
        WS_CONFIG_KEY,
        { allowNull: false }
      );
      return cfg || {};
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to get WebSocket configuration', {
        operation: 'get-ws-config',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      return {};
    }
  }

  getWSConfigCached() {
    return this._getCached(WS_CONFIG_CACHE_KEY, {});
  }

  getConfigTTL() {
    const { ENV } = require('../utils/constants.cjs');
    return ENV.CONFIG_CACHE_TTL;
  }

  clearCache() {
    const { cacheService } = this.ctx;
    cacheService.clear();
  }
}

module.exports = ConfigService;
