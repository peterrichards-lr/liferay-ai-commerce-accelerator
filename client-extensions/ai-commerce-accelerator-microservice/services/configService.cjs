const { tryParseJSON, createERC } = require('../utils/misc.cjs');
const {
  ERC_PREFIX,
  EMPTY_PLACEHOLDER,
  ENV,
} = require('../utils/constants.cjs');
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

const AI_API_CACHE_KEY = 'AI_API_KEY';
const AI_CREDENTIALS_CONFIG_KEY = 'ai-credentials';

const AI_MEDIA_API_CACHE_KEY = 'AI_MEDIA_API_KEY';
const AI_MEDIA_CREDENTIALS_CONFIG_KEY = 'ai-media-credentials';

const QUEUE_CONFIG_CACHE_KEY = 'QUEUE_CONFIG_KEY';
const QUEUE_CONFIG_KEY = 'queue-config';

const WS_CONFIG_CACHE_KEY = 'WS_CONFIG_KEY';
const WS_CONFIG_KEY = 'ws-config';

const LOG_MANAGEMENT_CACHE_KEY = 'LOG_MANAGEMENT_KEY';
const LOG_MANAGEMENT_CONFIG_KEY = 'log-management-config';

const WORKFLOW_RESILIENCE_CONFIG_CACHE_KEY = 'WORKFLOW_RESILIENCE_CONFIG_KEY';
const WORKFLOW_RESILIENCE_CONFIG_KEY = 'workflow-resilience-config';

const BATCH_SIZES_CONFIG_KEY = 'batch-sizes';
const BATCH_SIZES_CACHE_KEY = 'BATCH_SIZES_KEY';

const AI_MODEL_OPTIONS_CONFIG_KEY = 'ai-model-options';
const AI_MODEL_OPTIONS_CACHE_KEY = 'AI_MODEL_OPTIONS_KEY';

const EXCLUDE_LISTS_CONFIG_KEY = 'ai-exclude-lists';
const EXCLUDE_LISTS_CACHE_KEY = 'EXCLUDE_LISTS_KEY';

const GENERATION_LIMITS_CONFIG_KEY = 'generation-limits';
const GENERATION_LIMITS_CACHE_KEY = 'GENERATION_LIMITS_KEY';

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

      // HARDENING: Never cache the 'EMPTY' placeholder.
      // This ensures we always try to get the real key if it's not yet configured.
      if (parsedValue !== EMPTY_PLACEHOLDER) {
        cache.set(cacheKey, parsedValue, this.getConfigTTL());
      }

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
      '../generation-schemas',
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
      this.logger.warn(
        `Failed to read default categories from frontend config: ${error.message}`
      );
      return [];
    }
  }

  getCategoriesCached() {
    return this.getConfigCached(AI_CATEGORIES_CACHE_KEY);
  }

  async getExcludeLists(requestConfig) {
    const cacheKey = EXCLUDE_LISTS_CACHE_KEY;
    const configKey = EXCLUDE_LISTS_CONFIG_KEY;

    const cached = this.getConfigCached(cacheKey);
    if (cached) {
      return cached;
    }

    const remoteExcludeLists = await this.getConfig(
      requestConfig,
      cacheKey,
      configKey
    );

    if (remoteExcludeLists) {
      return remoteExcludeLists;
    }

    const defaultExcludeLists = {
      excludedAccounts: [{ name: 'Test Test' }],
      excludedProducts: [],
      excludedWarehouses: [],
      excludedPriceLists: [],
    };

    this.cache.set(cacheKey, defaultExcludeLists, this.getConfigTTL());
    return defaultExcludeLists;
  }

  getExcludeListsCached() {
    return this.getConfigCached(EXCLUDE_LISTS_CACHE_KEY);
  }

  async getGenerationLimits(requestConfig) {
    const logger = this.logger;
    try {
      const limits = await this.getConfig(
        requestConfig,
        GENERATION_LIMITS_CACHE_KEY,
        GENERATION_LIMITS_CONFIG_KEY
      );
      return limits || {};
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.(
        'Failed to get generation limits from Liferay Object, using defaults',
        {
          operation: 'get-generation-limits',
          errorReference: erc,
          message: error.message,
        }
      );
      return {
        defaultOrderDistribution: {
          completed: 60,
          open: 10,
          processing: 10,
          shipped: 20,
        },
        maxAccounts: 5000,
        maxOrders: 50000,
        maxProducts: 10000,
      };
    }
  }

  getGenerationLimitsCached() {
    const cached = this.getConfigCached(GENERATION_LIMITS_CACHE_KEY);
    return (
      cached || {
        defaultOrderDistribution: {
          completed: 60,
          open: 10,
          processing: 10,
          shipped: 20,
        },
        maxAccounts: 5000,
        maxOrders: 50000,
        maxProducts: 10000,
      }
    );
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
      throw new Error('Default image not configured.', { cause: error });
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
      throw new Error('Default PDF not configured.', { cause: error });
    }
  }

  getDefaultPdfCached() {
    return this.getConfigCached(DEFAULT_PDF_CACHE_KEY);
  }

  async getAIKey(requestConfig) {
    const logger = this.logger;
    try {
      const key = await this.getConfig(
        requestConfig,
        AI_API_CACHE_KEY,
        AI_CREDENTIALS_CONFIG_KEY
      );
      if (key && key !== 'null' && key !== '""' && key !== EMPTY_PLACEHOLDER) {
        return key;
      }

      // FALLBACK: Use environment variable if Liferay Object is missing/empty
      if (ENV.AI_API_KEY && ENV.AI_API_KEY.trim().length > 0) {
        logger?.debug?.('AI key not found in Liferay, falling back to ENV', {
          operation: 'get-ai-key-fallback',
        });
        return ENV.AI_API_KEY.trim();
      }

      return null;
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);

      // If we have an ENV fallback, use it even if Liferay request failed
      if (ENV.AI_API_KEY && ENV.AI_API_KEY.trim().length > 0) {
        logger?.warn?.(
          'Failed to get AI key from Liferay, falling back to ENV',
          {
            operation: 'get-ai-key-fallback-error',
            errorReference: erc,
            message: error.message,
          }
        );
        return ENV.AI_API_KEY.trim();
      }

      logger?.errorWithStack?.(error, {
        operation: 'get-ai-key',
        errorReference: erc,
        message: 'Failed to get AI key from Liferay Object',
      });
      throw new Error('AI API key not configured.', { cause: error });
    }
  }

  getAIKeyCached() {
    const key = this.getConfigCached(AI_API_CACHE_KEY);
    if (key && key !== 'null' && key !== '""' && key !== EMPTY_PLACEHOLDER) {
      return key;
    }

    // FALLBACK: Use environment variable if not in cache
    if (ENV.AI_API_KEY && ENV.AI_API_KEY.trim().length > 0) {
      return ENV.AI_API_KEY.trim();
    }

    return null;
  }

  async getAIMediaKey(requestConfig) {
    const logger = this.logger;
    try {
      // 1. Check if media provider is INHERIT
      const aiConfig = await this.getAIConfig(requestConfig);
      if (aiConfig?.mediaProvider === 'inherit') {
        const key = await this.getAIKey(requestConfig);

        // HARDENING: Populate the media cache key with the core key
        // to ensure getAIMediaKeyCached returns the correct value
        if (key && key !== EMPTY_PLACEHOLDER) {
          this.cache.set(AI_MEDIA_API_CACHE_KEY, key, this.getConfigTTL());
        }

        return key;
      }

      const key = await this.getConfig(
        requestConfig,
        AI_MEDIA_API_CACHE_KEY,
        AI_MEDIA_CREDENTIALS_CONFIG_KEY
      );
      if (key && key !== 'null' && key !== '""' && key !== EMPTY_PLACEHOLDER) {
        return key;
      }

      // FALLBACK: Use environment variable if Liferay Object is missing/empty
      if (ENV.AI_MEDIA_API_KEY && ENV.AI_MEDIA_API_KEY.trim().length > 0) {
        logger?.debug?.(
          'AI media key not found in Liferay, falling back to ENV',
          {
            operation: 'get-ai-media-key-fallback',
          }
        );
        return ENV.AI_MEDIA_API_KEY.trim();
      }

      return null;
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);

      // If we have an ENV fallback, use it even if Liferay request failed
      if (ENV.AI_MEDIA_API_KEY && ENV.AI_MEDIA_API_KEY.trim().length > 0) {
        logger?.warn?.(
          'Failed to get AI media key from Liferay, falling back to ENV',
          {
            operation: 'get-ai-media-key-fallback-error',
            errorReference: erc,
            message: error.message,
          }
        );
        return ENV.AI_MEDIA_API_KEY.trim();
      }

      logger?.errorWithStack?.(error, {
        operation: 'get-ai-media-key',
        errorReference: erc,
        message: 'Failed to get AI media key from Liferay Object',
      });
      throw new Error('AI media key not configured.', { cause: error });
    }
  }

  getAIMediaKeyCached() {
    const key = this.getConfigCached(AI_MEDIA_API_CACHE_KEY);
    if (key && key !== 'null' && key !== '""' && key !== EMPTY_PLACEHOLDER) {
      return key;
    }

    // FALLBACK: Use environment variable if not in cache
    if (ENV.AI_MEDIA_API_KEY && ENV.AI_MEDIA_API_KEY.trim().length > 0) {
      return ENV.AI_MEDIA_API_KEY.trim();
    }

    return null;
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

  async getWorkflowResilienceConfig(requestConfig) {
    return this._getConfigWithFallback(
      requestConfig,
      WORKFLOW_RESILIENCE_CONFIG_CACHE_KEY,
      WORKFLOW_RESILIENCE_CONFIG_KEY,
      'get-workflow-resilience-config',
      'Failed to get workflow resilience configuration'
    );
  }

  getWorkflowResilienceConfigCached() {
    return (
      this.getConfigCached(WORKFLOW_RESILIENCE_CONFIG_CACHE_KEY) || {
        initialDelayMs: 5000,
        maxRetries: 5,
        multiplier: 2,
      }
    );
  }

  async getBatchSizes(requestConfig) {
    const logger = this.logger;
    try {
      const sizes = await this.getConfig(
        requestConfig,
        BATCH_SIZES_CACHE_KEY,
        BATCH_SIZES_CONFIG_KEY
      );
      return Array.isArray(sizes) && sizes.length > 0 ? sizes : [10, 25, 50];
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.(
        'Failed to get batch sizes from Liferay Object, using defaults',
        {
          operation: 'get-batch-sizes',
          errorReference: erc,
          message: error.message,
        }
      );
      return [10, 25, 50];
    }
  }

  getBatchSizesCached() {
    const cached = this.getConfigCached(BATCH_SIZES_CACHE_KEY);
    return Array.isArray(cached) && cached.length > 0 ? cached : [10, 25, 50];
  }

  async getAIModelOptions(requestConfig) {
    const logger = this.logger;
    try {
      const options = await this.getConfig(
        requestConfig,
        AI_MODEL_OPTIONS_CACHE_KEY,
        AI_MODEL_OPTIONS_CONFIG_KEY
      );
      const aiConfig = await this.getAIConfig(requestConfig);

      const resolvedOptions =
        Array.isArray(options) && options.length > 0
          ? options
          : [
              { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
              { label: 'GPT-4o', value: 'gpt-4o' },
              { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
            ];

      let defaultModel = aiConfig?.defaultModel || null;
      const defaultModelExists = resolvedOptions.some(
        (opt) => opt.value === defaultModel
      );

      if (!defaultModel || !defaultModelExists) {
        defaultModel =
          resolvedOptions.length > 0 ? resolvedOptions[0].value : null;
        logger?.warn?.(
          `Default AI model '${aiConfig?.defaultModel}' not found in available options. Setting default to '${defaultModel}'.`,
          {
            operation: 'get-ai-model-options-fallback',
          }
        );
      }

      return { aiModelOptions: resolvedOptions, defaultModel };
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.(
        'Failed to get AI model options from Liferay Object, using defaults',
        {
          operation: 'get-ai-model-options',
          errorReference: erc,
          message: error.message,
        }
      );
      return {
        aiModelOptions: [
          { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
          { label: 'GPT-4o', value: 'gpt-4o' },
          { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
        ],
        defaultModel: 'gpt-4o-mini',
      };
    }
  }

  getAIModelOptionsCached() {
    const cached = this.getConfigCached(AI_MODEL_OPTIONS_CACHE_KEY);
    const cachedAIConfig = this.getAIConfigCached();

    const resolvedOptions =
      Array.isArray(cached) && cached.length > 0
        ? cached
        : [
            { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
            { label: 'GPT-4o', value: 'gpt-4o' },
            { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
          ];

    let defaultModel = cachedAIConfig?.defaultModel || null;
    const defaultModelExists = resolvedOptions.some(
      (opt) => opt.value === defaultModel
    );

    if (!defaultModel || !defaultModelExists) {
      defaultModel =
        resolvedOptions.length > 0 ? resolvedOptions[0].value : null;
    }

    return { aiModelOptions: resolvedOptions, defaultModel };
  }

  async saveConfig(requestConfig, configKey, configValue) {
    const liferay = this._requireLiferay();
    const result = await liferay.updateConfig(
      requestConfig,
      configKey,
      configValue
    );

    // Clear cache
    if (configKey === AI_CREDENTIALS_CONFIG_KEY) {
      this.cache.delete(AI_API_CACHE_KEY);
    } else if (configKey === AI_MEDIA_CREDENTIALS_CONFIG_KEY) {
      this.cache.delete(AI_MEDIA_API_CACHE_KEY);
    } else if (configKey === AI_CONFIG_KEY) {
      this.cache.delete(AI_CONFIG_CACHE_KEY);
    }

    return result;
  }

  async syncEnvironmentKeys() {
    const { lookupConfig } = require('@rotty3000/config-node');
    const logger = this.logger;

    // Resolve Core Key & Provider
    // Priority: AI_API_KEY > OPENAI_API_KEY > GEMINI_API_KEY > ANTHROPIC_API_KEY
    let coreApiKey = lookupConfig('AI_API_KEY');
    let detectedProvider = null;

    if (!coreApiKey || String(coreApiKey).trim().length === 0) {
      if (lookupConfig('OPENAI_API_KEY')) {
        coreApiKey = lookupConfig('OPENAI_API_KEY');
        detectedProvider = 'openai';
      } else if (lookupConfig('GEMINI_API_KEY')) {
        coreApiKey = lookupConfig('GEMINI_API_KEY');
        detectedProvider = 'gemini';
      } else if (lookupConfig('ANTHROPIC_API_KEY')) {
        coreApiKey = lookupConfig('ANTHROPIC_API_KEY');
        detectedProvider = 'anthropic';
      }
    }

    const mediaApiKey = lookupConfig('AI_MEDIA_API_KEY');

    logger?.debug?.('Startup key sync: Checking environment...', {
      foundAIKey: !!coreApiKey,
      foundMediaKey: !!mediaApiKey,
      detectedProvider,
    });

    // 1. Sync Core AI Key & Provider Configuration
    if (coreApiKey && String(coreApiKey).trim().length > 0) {
      const trimmedCoreKey = String(coreApiKey).trim();
      logger?.info?.(
        'Syncing AI API credentials from environment to Liferay...',
        {
          operation: 'sync-env-keys',
        }
      );

      try {
        await this.saveConfig({}, AI_CREDENTIALS_CONFIG_KEY, trimmedCoreKey);

        // AUTO-PROVISION PROVIDER: If we detected a provider and Liferay has no config, set it.
        const currentAIConfig = await this.getAIConfig({});
        if (
          detectedProvider &&
          (!currentAIConfig || !currentAIConfig.provider)
        ) {
          logger?.info?.(
            `Auto-configuring AI provider as '${detectedProvider}' based on environment variable.`,
            {
              operation: 'sync-env-keys',
            }
          );

          const newConfig = {
            provider: detectedProvider,
            mediaProvider: 'inherit',
            defaultModel:
              detectedProvider === 'openai'
                ? 'gpt-4o-mini'
                : detectedProvider === 'gemini'
                  ? 'gemini-1.5-flash'
                  : 'claude-3-haiku',
            temperature: 0.7,
            maxTokens: 4000,
            requestTimeoutMs: 60000,
          };

          await this.saveConfig({}, AI_CONFIG_KEY, newConfig);
        }

        // HARDENING: If media key is missing from ENV, also sync core key to media credentials
        // to ensure "Same as Core" works consistently and is cached correctly.
        if (!mediaApiKey || String(mediaApiKey).trim().length === 0) {
          logger?.info?.(
            'Media AI key missing from ENV. Syncing Core AI key to media credentials as fallback.',
            { operation: 'sync-env-keys' }
          );
          await this.saveConfig(
            {},
            AI_MEDIA_CREDENTIALS_CONFIG_KEY,
            trimmedCoreKey
          );
        }

        logger?.info?.('Successfully synced AI API key to Liferay.', {
          operation: 'sync-env-keys',
        });

        // SECURITY: Remove from process.env after sync to avoid leaks
        delete process.env.AI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
      } catch (error) {
        logger?.error?.('Failed to sync AI API key to Liferay', {
          operation: 'sync-env-keys',
          error: error.message,
        });
      }
    }

    // 2. Sync Media AI Key
    if (mediaApiKey && String(mediaApiKey).trim().length > 0) {
      logger?.info?.(
        'Syncing AI_MEDIA_API_KEY from environment to Liferay...',
        {
          operation: 'sync-env-keys',
        }
      );

      try {
        await this.saveConfig(
          {},
          AI_MEDIA_CREDENTIALS_CONFIG_KEY,
          String(mediaApiKey).trim()
        );
        logger?.info?.('Successfully synced AI_MEDIA_API_KEY to Liferay.', {
          operation: 'sync-env-keys',
        });

        // SECURITY: Remove from process.env after sync
        delete process.env.AI_MEDIA_API_KEY;
      } catch (error) {
        logger?.error?.('Failed to sync AI_MEDIA_API_KEY to Liferay', {
          operation: 'sync-env-keys',
          error: error.message,
        });
      }
    }

    // 3. Seed Log Management Cache
    await this.getLogManagementConfig({});
  }

  async checkHealth(requestConfig) {
    const liferay = this._requireLiferay();
    const logger = this.logger;

    const health = {
      liferay: { status: 'UNKNOWN', message: '' },
      aiText: { status: 'UNKNOWN', provider: 'OPENAI' },
      aiMedia: { status: 'UNKNOWN', provider: 'OPENAI' },
      prompts: { status: 'OK', missing: [] },
      schemas: { status: 'OK', missing: [] },
    };

    try {
      // Check Liferay connection
      try {
        await liferay.getChannels(requestConfig, { pageSize: 1 });
        health.liferay.status = 'CONNECTED';
      } catch (err) {
        health.liferay.status = 'ERROR';
        health.liferay.message = err.message;
      }

      // Check AI Config
      const aiConfig = await this.getAIConfig(requestConfig);
      health.aiText.provider = (aiConfig?.provider || 'OPENAI').toUpperCase();
      health.aiMedia.provider = (
        aiConfig?.mediaProvider || 'INHERIT'
      ).toUpperCase();

      let textKey = null;
      try {
        textKey = await this.getAIKey(requestConfig);
      } catch (e) {
        logger.debug('AI Text key check failed during health check', {
          error: e.message,
        });
      }
      health.aiText.status = textKey ? 'CONFIGURED' : 'MISSING';

      let mediaKey = null;
      try {
        mediaKey = await this.getAIMediaKey(requestConfig);
      } catch (e) {
        logger.debug('AI Media key check failed during health check', {
          error: e.message,
        });
      }

      if (health.aiMedia.provider === 'INHERIT') {
        health.aiMedia.status = textKey ? 'CONFIGURED' : 'MISSING';
      } else {
        health.aiMedia.status = mediaKey ? 'CONFIGURED' : 'MISSING';
      }

      // Check Propmts (existence check)
      const entities = ['product', 'account', 'order', 'warehouse'];
      for (const entity of entities) {
        const prompt = await this.getAIPrompt(requestConfig, entity);
        if (!prompt) {
          health.prompts.status = 'WARNING';
          health.prompts.missing.push(entity);
        }
        const schema = await this.getAISchema(requestConfig, entity);
        if (!schema) {
          health.schemas.status = 'WARNING';
          health.schemas.missing.push(entity);
        }
      }

      return health;
    } catch (error) {
      logger.error('Failed to check config health', { error: error.message });
      return health;
    }
  }

  async getLogManagementConfig(requestConfig) {
    try {
      const config = await this.getConfig(
        requestConfig,
        LOG_MANAGEMENT_CONFIG_KEY,
        LOG_MANAGEMENT_CACHE_KEY
      );

      return {
        retentionCount: config?.retentionCount ?? 10,
        autoCycleTime: config?.autoCycleTime ?? '00:00',
        enabled: config?.enabled ?? true,
      };
    } catch (error) {
      this.logger.error('Failed to get log management config', {
        error: error.message,
      });
      return { retentionCount: 10, autoCycleTime: '00:00', enabled: true };
    }
  }

  getLogManagementConfigCached() {
    return this.getConfigCached(LOG_MANAGEMENT_CACHE_KEY);
  }

  async saveLogManagementConfig(requestConfig, logConfig) {
    return await this.saveConfig(
      requestConfig,
      LOG_MANAGEMENT_CONFIG_KEY,
      logConfig,
      LOG_MANAGEMENT_CACHE_KEY
    );
  }

  clearCache() {
    const cache = this.cache;

    cache?.clear?.();
  }
}

module.exports = ConfigService;
