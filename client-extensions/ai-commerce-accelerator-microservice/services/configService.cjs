const AI_CONFIG_CACHE_KEY = 'AI_CONFIG_KEY';
const AI_CONFIG_KEY = 'ai-config';

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

  async getConfig(requestConfig, cacheKey, configKey) {
    const { cache, liferay } = this.ctx;

    if (!requestConfig) {
      throw new Error(
        'OAuth configuration required: liferayUrl, clientId, and clientSecret must be provided'
      );
    }

    const cached = cache.get(cacheKey);
    if (cached) {
      return cached.value;
    }

    const response = await liferay.getConfig(requestConfig, configKey);
    if (response.items && response.items.length > 0) {
      const value = response.items[0].configValue;
      let parsedValue = value;

      try {
        parsedValue = JSON.parse(value);
      } catch {}

      cache.set(cacheKey, {
        value: parsedValue,
        timestamp: Date.now(),
      });

      return parsedValue;
    }

    return null;
  }

  getConfigCached(cacheKey) {
    const { cache } = this.ctx;
    const cached = cache.get(cacheKey);
    return cached ? cached.value : null;
  }

  async getDefaultImage(requestConfig) {
    const { logger } = this.ctx;
    try {
      return await this.getConfig(
        requestConfig,
        DEFAULT_IMAGE_CACHE_KEY,
        DEFAULT_IMAGE_CONFIG_KEY
      );
    } catch (error) {
      logger.error('Failed to get default image from Liferay Object:', error);
      throw new Error('Default image not configured.');
    }
  }

  getDefaultImageCached() {
    return this.getConfigCached(DEFAULT_IMAGE_CACHE_KEY);
  }

  async getDefaultPdf(requestConfig) {
    const { logger } = this.ctx;
    try {
      return await this.getConfig(
        requestConfig,
        DEFAULT_PDF_CACHE_KEY,
        DEFAULT_PDF_CONFIG_KEY
      );
    } catch (error) {
      logger.error('Failed to get default PDF from Liferay Object:', error);
      throw new Error('Default PDF not configured.');
    }
  }

  getDefaultPdfCached() {
    return this.getConfigCached(DEFAULT_PDF_CACHE_KEY);
  }

  async getOpenAIKey(requestConfig) {
    const { logger } = this.ctx;
    try {
      return await this.getConfig(
        requestConfig,
        OPENAPI_CACHE_KEY,
        OPENAI_CONFIG_KEY
      );
    } catch (error) {
      logger.error('Failed to get OpenAI key from Liferay Object:', error);
      throw new Error('OpenAI API key not configured.');
    }
  }

  getOpenAIKeyCached() {
    return this.getConfigCached(OPENAPI_CACHE_KEY);
  }

  async getCacheConfig(requestConfig) {
    const { logger } = this.ctx;
    try {
      const config = await this.getConfig(
        requestConfig,
        CACHE_CONFIG_CACHE_KEY,
        CACHE_CONFIG_KEY
      );
      return config || {};
    } catch (error) {
      logger.error('Failed to get cache configuration:', error);
      return {};
    }
  }

  getCacheConfigCached() {
    return this.getConfigCached(CACHE_CONFIG_CACHE_KEY) || {};
  }

  async getBatchPollingConfig(requestConfig) {
    const { logger } = this.ctx;
    try {
      const config = await this.getConfig(
        requestConfig,
        BATCH_POLLING_CONFIG_CACHE_KEY,
        BATCH_POLLING_CONFIG_KEY
      );
      return config || {};
    } catch (error) {
      logger.error('Failed to get batch polling configuration:', error);
      return {};
    }
  }

  getBatchPollingConfigCached() {
    return this.getConfigCached(BATCH_POLLING_CONFIG_CACHE_KEY) || {};
  }

  async getQueueConfig(requestConfig) {
    return this.getConfig(
      requestConfig,
      QUEUE_CONFIG_CACHE_KEY,
      QUEUE_CONFIG_KEY
    );
  }

  getQueueConfigCached() {
    return this.getConfigCached(QUEUE_CONFIG_CACHE_KEY);
  }

  async getAIConfig(requestConfig) {
    const { cache, liferay } = this.ctx;
    const cached = cache.get(AI_CONFIG_CACHE_KEY);
    if (cached) return cached;

    const resp = await liferay.getConfig(requestConfig, AI_CONFIG_KEY);
    if (resp.items?.length) {
      const raw = resp.items[0].configValue;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      cache.set(AI_CONFIG_CACHE_KEY, parsed, this.getConfigTTL());
      return parsed;
    }
    return null;
  }

  getAIConfigCached() {
    const { cache } = this.ctx;
    return cache.get(AI_CONFIG_CACHE_KEY);
  }

  async getOAuthConfig(requestConfig) {
    const { cache, liferay, logger } = this.ctx;
    try {
      const cached = cache.get(OAUTH_CONFIG_CACHE_KEY);
      if (cached) return cached;

      const response = await liferay.getConfig(requestConfig, OAUTH_CONFIG_KEY);
      if (response.items && response.items.length > 0) {
        const configValue = JSON.parse(response.items[0].configValue || '{}');
        cache.set(OAUTH_CONFIG_CACHE_KEY, configValue, this.getConfigTTL());
        return configValue;
      }
      return {};
    } catch (error) {
      logger?.warn?.('Failed to load OAuth config:', error.message);
      return {};
    }
  }

  getOAuthConfigCached() {
    const { cache } = this.ctx;
    return cache.get('OAUTH-CONFIG');
  }

  async getObjectStorageConfig(requestConfig) {
    const { cache, liferay, logger } = this.ctx;
    try {
      const cached = cache.get(OBJECT_STORAGE_CONFIG_CACHE_KEY);
      if (cached) return cached;
      const response = await liferay.getConfig(
        requestConfig,
        OBJECT_STORAGE_CONFIG_KEY
      );
      if (response.items && response.items.length > 0) {
        const cfg = JSON.parse(response.items[0].configValue || '{}');
        cache.set(OBJECT_STORAGE_CONFIG_CACHE_KEY, cfg, this.getConfigTTL());
        return cfg;
      }
      return {};
    } catch (e) {
      logger?.warn?.('Failed to load Object Storage config:', e.message);
      return {};
    }
  }

  getObjectStorageConfigCached() {
    const { cache } = this.ctx;
    return cache.get(OBJECT_STORAGE_CONFIG_CACHE_KEY);
  }

  async getWsConfig(requestConfig) {
    const { logger } = this.ctx;
    try {
      const config = await this.getConfig(
        requestConfig,
        WS_CONFIG_CACHE_KEY,
        WS_CONFIG_KEY
      );
      return config || {};
    } catch (error) {
      logger.error('Failed to get WebSocket configuration:', error);
      return {};
    }
  }

  getWsConfigCached() {
    return this.getConfigCached(WS_CONFIG_CACHE_KEY) || {};
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