const axios = require('axios');

const liferayService = require('./liferayService.cjs');

const OPENAPI_CACHE_KEY = 'OPENAI_API_KEY';
const OPENAI_CONFIG_KEY = 'open-ai-key';

const DEFAULT_IMAGE_CACHE_KEY = 'DEFAULT_IMAGE_KEY';
const DEFAULT_IMAGE_CONFIG_HEY = 'default-image';

const DEFAULT_PDF_CACHE_KEY = 'DEFAULT_PDF_KEY';
const DEFAULT_PDF_CONFIG_HEY = 'default-pdf';

class ConfigService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async getConfig(requestConfig, cacheKey, configKey) {
    if (!requestConfig) {
      throw new Error(
        'OAuth configuration required: liferayUrl, clientId, and clientSecret must be provided'
      );
    }

    if (
      !requestConfig.liferayUrl ||
      !requestConfig.clientId ||
      !requestConfig.clientSecret
    ) {
      throw new Error(
        'Missing OAuth parameters: liferayUrl, clientId, and clientSecret are required'
      );
    }

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.value;
    }

    const response = await liferayService.getConfig(requestConfig, configKey);
    if (response.items && response.items.length > 0) {
      const apiKey = response.items[0].configValue;

      // Cache the result
      this.cache.set(cacheKey, {
        value: apiKey,
        timestamp: Date.now(),
      });

      return apiKey;
    }
  }

  getConfigCached(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.value;
    } else {
      return null;
    }
  }

  async getDefaultImage(requestConfig) {
    try {
      return await this.getConfig(
        requestConfig,
        DEFAULT_IMAGE_CACHE_KEY,
        DEFAULT_IMAGE_CONFIG_HEY
      );
    } catch (error) {
      console.error(
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
    try {
      return await this.getConfig(
        requestConfig,
        OPENAPI_CACHE_KEY,
        OPENAI_CONFIG_KEY
      );
    } catch (error) {
      console.error('Failed to get OpenAI key from Liferay Object:', error);
      throw new Error(
        'OpenAI API key not configured. Please set it in the AI Configuration object.'
      );
    }
  }

  async getDefaultPdf(requestConfig) {
    try {
      return await this.getConfig(
        requestConfig,
        DEFAULT_PDF_CACHE_KEY,
        DEFAULT_PDF_CONFIG_HEY
      );
    } catch (error) {
      console.error(
        'Failed to get the default PDF from Liferay Object:',
        error
      );
      throw new Error(
        'Default PDF not configured. Please set it in the AI Configuration object.'
      );
    }
  }

  getDefaultPdfCached() {
    return this.getConfigCached(DEFAULT_PDF_CACHE_KEY);
  }

  async getOpenAIKey(requestConfig) {
    try {
      return await this.getConfig(
        requestConfig,
        OPENAPI_CACHE_KEY,
        OPENAI_CONFIG_KEY
      );
    } catch (error) {
      console.error('Failed to get OpenAI key from Liferay Object:', error);
      throw new Error(
        'OpenAI API key not configured. Please set it in the AI Configuration object.'
      );
    }
  }

  getOpenAIKeyCached() {
    return this.getConfigCached(OPENAPI_CACHE_KEY);
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = { ConfigService };
