const axios = require('axios');

const liferayService = require('./liferayService.cjs');

const OPENAPI_CACHE_KEY = 'OPENAI_API_KEY';
const OPENAI_CONFIG_KEY = 'open-ai-key';

class ConfigService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async getOpenAIKey(requestConfig) {
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

    const cached = this.cache.get(OPENAPI_CACHE_KEY);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.value;
    }

    try {
      const response = await liferayService.getConfig(
        requestConfig,
        OPENAI_CONFIG_KEY
      );
      if (response.items && response.items.length > 0) {
        const apiKey = response.items[0].configValue;

        // Cache the result
        this.cache.set(OPENAPI_CACHE_KEY, {
          value: apiKey,
          timestamp: Date.now(),
        });

        return apiKey;
      }
    } catch (error) {
      console.error('Failed to get OpenAI key from Liferay Object:', error);
      throw new Error(
        'OpenAI API key not configured. Please set it in the AI Configuration object.'
      );
    }
  }

  getOpenAIKeyCached() {
    const cached = this.cache.get(OPENAPI_CACHE_KEY);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.value;
    } else {
      return null;
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = { ConfigService };
