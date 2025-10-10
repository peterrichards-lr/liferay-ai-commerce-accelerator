const OPENAPI_CACHE_KEY = 'OPENAI_API_KEY';
const OPENAI_CONFIG_KEY = 'open-ai-key';

const DEFAULT_IMAGE_CACHE_KEY = 'DEFAULT_IMAGE_KEY';
const DEFAULT_IMAGE_CONFIG_HEY = 'default-image';

const DEFAULT_PDF_CACHE_KEY = 'DEFAULT_PDF_KEY';
const DEFAULT_PDF_CONFIG_HEY = 'default-pdf';

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
      const apiKey = response.items[0].configValue;

      // Cache the result
      cache.set(cacheKey, {
        value: apiKey,
        timestamp: Date.now(),
      });

      return apiKey;
    }
  }

  getConfigCached(cacheKey) {
    const { cache } = this.ctx;
    return cache.get(cacheKey);
  }

  async getDefaultImage(requestConfig) {
    const { logger } = this.ctx;
    try {
      return await this.getConfig(
        requestConfig,
        DEFAULT_IMAGE_CACHE_KEY,
        DEFAULT_IMAGE_CONFIG_HEY
      );
    } catch (error) {
      logger.error(
        'Failed to get the default image from Liferay Object:',
        error
      );
      throw new Error(
        'Default image not configured. Please set it in the AI Configuration object.'
      );
    }
  }

  getDefaultImageCached() {
    return this.getConfigCached(DEFAULT_IMAGE_CACHE_KEY);
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
      throw new Error(
        'OpenAI API key not configured. Please set it in the AI Configuration object.'
      );
    }
  }

  async getDefaultPdf(requestConfig) {
    const { logger } = this.ctx;
    try {
      return await this.getConfig(
        requestConfig,
        DEFAULT_PDF_CACHE_KEY,
        DEFAULT_PDF_CONFIG_HEY
      );
    } catch (error) {
      logger.error('Failed to get the default PDF from Liferay Object:', error);
      throw new Error(
        'Default PDF not configured. Please set it in the AI Configuration object.'
      );
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
      throw new Error(
        'OpenAI API key not configured. Please set it in the AI Configuration object.'
      );
    }
  }

  getOpenAIKeyCached() {
    return this.getConfigCached(OPENAPI_CACHE_KEY);
  }

  clearCache() {
    const { cacheService } = this.ctx;
    cacheService.clear();
  }
}

module.exports = ConfigService;
