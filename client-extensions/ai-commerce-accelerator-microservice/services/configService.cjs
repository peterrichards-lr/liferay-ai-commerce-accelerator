const { tryParseJSON, createERC } = require('../utils/misc.cjs');
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

  async getCacheConfig(requestConfig) {
    const logger = this.logger;
    try {
      const cfg = await this.getConfig(
        requestConfig,
        CACHE_CONFIG_CACHE_KEY,
        CACHE_CONFIG_KEY
      );
      return cfg || {};
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-cache-config',
        errorReference: erc,
        message: 'Failed to get cache configuration',
      });
      return {};
    }
  }

  getCacheConfigCached() {
    return this.getConfigCached(CACHE_CONFIG_CACHE_KEY) || {};
  }

  async getBatchPollingConfig(requestConfig) {
    const logger = this.logger;
    try {
      const cfg = await this.getConfig(
        requestConfig,
        BATCH_POLLING_CONFIG_CACHE_KEY,
        BATCH_POLLING_CONFIG_KEY
      );
      return cfg || {};
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-batch-polling-config',
        errorReference: erc,
        message: 'Failed to get batch polling configuration',
      });
      return {};
    }
  }

  getBatchPollingConfigCached() {
    return this.getConfigCached(BATCH_POLLING_CONFIG_CACHE_KEY) || {};
  }

  async getQueueConfig(requestConfig) {
    const logger = this.logger;
    try {
      const cfg = await this.getConfig(
        requestConfig,
        QUEUE_CONFIG_CACHE_KEY,
        QUEUE_CONFIG_KEY
      );
      return cfg || {};
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-queue-config',
        errorReference: erc,
        message: 'Failed to get queue configuration',
      });
      return {};
    }
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

  async getAIPromptsConfig(requestConfig) {
    const cache = this.cache;
    const logger = this.logger;
    const liferay = this._requireLiferay();
    const cached = cache.get(AI_PROMPTS_CONFIG_CACHE_KEY);
    if (cached) return cached;

    try {
      const resp = await liferay.getConfig(
        requestConfig,
        AI_PROMPTS_CONFIG_KEY
      );
      if (resp?.items?.length) {
        const raw = resp.items[0].configValue;
        const parsed = typeof raw === 'string' ? tryParseJSON(raw, {}) : raw;
        cache.set(AI_PROMPTS_CONFIG_CACHE_KEY, parsed, this.getConfigTTL());
        return parsed;
      }
      return null;
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-ai-prompts-config',
        errorReference: erc,
        message: 'Failed to get AI prompts configuration',
      });
      return null;
    }
  }

  getAIPromptsConfigCached() {
    const cache = this.cache;
    return cache.get(AI_PROMPTS_CONFIG_CACHE_KEY) || null;
  }

  async getOAuthConfig(requestConfig) {
    const cache = this.cache;
    const logger = this.logger;
    const liferay = this._requireLiferay();
    try {
      const cached = cache.get(OAUTH_CONFIG_CACHE_KEY);
      if (cached) return cached;

      const response = await liferay.getConfig(requestConfig, OAUTH_CONFIG_KEY);

      if (response?.items && response.items.length > 0) {
        const cfg = tryParseJSON(response.items[0].configValue, {});
        cache.set(OAUTH_CONFIG_CACHE_KEY, cfg, this.getConfigTTL());
        return cfg;
      }

      return {};
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.('Failed to load OAuth config:', {
        operation: 'get-oauth-config',
        errorReference: erc,
        message: error?.message,
      });
      return {};
    }
  }

  getOAuthConfigCached() {
    const cache = this.cache;
    return cache.get(OAUTH_CONFIG_CACHE_KEY) || {};
  }

  async getObjectStorageConfig(requestConfig) {
    const cache = this.cache;
    const logger = this.logger;
    const liferay = this._requireLiferay();
    try {
      const cached = cache.get(OBJECT_STORAGE_CONFIG_CACHE_KEY);
      if (cached) return cached;

      const response = await liferay.getConfig(
        requestConfig,
        OBJECT_STORAGE_CONFIG_KEY
      );

      if (response?.items && response.items.length > 0) {
        const cfg = tryParseJSON(response.items[0].configValue, {});
        cache.set(OBJECT_STORAGE_CONFIG_CACHE_KEY, cfg, this.getConfigTTL());
        return cfg;
      }

      return {};
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.('Failed to load Object Storage config:', {
        operation: 'get-object-storage-config',
        errorReference: erc,
        message: error?.message,
      });
      return {};
    }
  }

  getObjectStorageConfigCached() {
    const cache = this.cache;
    return cache.get(OBJECT_STORAGE_CONFIG_CACHE_KEY) || {};
  }

  async getWSConfig(requestConfig) {
    const logger = this.logger;
    try {
      const cfg = await this.getConfig(
        requestConfig,
        WS_CONFIG_CACHE_KEY,
        WS_CONFIG_KEY
      );
      return cfg || {};
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(error, {
        operation: 'get-ws-config',
        errorReference: erc,
        message: 'Failed to get WebSocket configuration',
      });
      return {};
    }
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
