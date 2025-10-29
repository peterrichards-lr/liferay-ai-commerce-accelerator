const BATCH_POLLING_CONFIG_CACHE_KEY = 'BATCH_POLLING_CONFIG';
const BATCH_POLLING_CONFIG_KEY = 'batch-polling-config';

const CACHE_CONFIG_CACHE_KEY = 'CACHE_CONFIG';
const CACHE_CONFIG_KEY = 'cache-config';

const DEFAULT_IMAGE_CACHE_KEY = 'DEFAULT_IMAGE_KEY';
const DEFAULT_IMAGE_CONFIG_KEY = 'default-image';

const DEFAULT_PDF_CACHE_KEY = 'DEFAULT_PDF_KEY';
const DEFAULT_PDF_CONFIG_KEY = 'default-pdf';

const OPENAI_CONFIG_KEY = 'open-ai-key';
const OPENAPI_CACHE_KEY = 'OPENAI_API_KEY';

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

  clearCache() {
    const { cacheService } = this.ctx;
    cacheService.clear();
  }
}

module.exports = ConfigService;
