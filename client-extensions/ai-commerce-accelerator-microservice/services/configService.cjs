const { tryParseJSON, createERC } = require('../utils/misc.cjs');
const {
  ERC_PREFIX,
  EMPTY_PLACEHOLDER,
  ENV,
} = require('../utils/constants.cjs');
const {
  DEFAULT_MODEL_OPTIONS,
  defaultModelForProvider,
} = require('../utils/modelCatalog.cjs');
const { providerEnvVar, resolveCoreKey } = require('../utils/apiKeys.cjs');
const {
  DEFAULT_CHUNK_SIZES,
  DEFAULT_MAX_TOKENS,
} = require('../utils/aiRequestOptions.cjs');
const {
  configurationUnavailable,
  describeConfigurationSource,
  resolveConfigurationSource,
} = require('../utils/configurationSource.cjs');
const { emptyExcludeLists } = require('@liferay/accelerator-sdk');
const {
  listPromptNames,
  listSchemaNames,
} = require('../utils/configurationAssets.cjs');
const {
  isUsableLiferayUrl,
  resolveEffectiveLiferayConnection,
} = require('../utils/liferayEnv.cjs');
const { normalizeCatalogExpiryConfig } = require('../utils/catalogExpiry.cjs');
const {
  normalizeMediaArchiveConfig,
} = require('../utils/mediaArchiveConfig.cjs');
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

const CATALOG_EXPIRY_CONFIG_CACHE_KEY = 'CATALOG_EXPIRY_CONFIG_KEY';
const MEDIA_ARCHIVE_CONFIG_CACHE_KEY = 'MEDIA_ARCHIVE_CONFIG_KEY';
const CATALOG_EXPIRY_CONFIG_KEY = 'catalog-expiry-config';
const MEDIA_ARCHIVE_CONFIG_KEY = 'media-archive-config';

const DEFAULT_IMAGE_CACHE_KEY = 'DEFAULT_IMAGE_KEY';
const DEFAULT_IMAGE_CONFIG_KEY = 'default-image';

const DEFAULT_PDF_CACHE_KEY = 'DEFAULT_PDF_KEY';
const DEFAULT_PDF_CONFIG_KEY = 'default-pdf';

const OAUTH_CONFIG_CACHE_KEY = 'OAUTH_CONFIG_KEY';
const OAUTH_CONFIG_KEY = 'oauth-config';

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

const AI_CHUNK_SIZES_CONFIG_KEY = 'ai-chunk-sizes';
const AI_CHUNK_SIZES_CACHE_KEY = 'AI_CHUNK_SIZES_KEY';

class ConfigService {
  constructor(ctx) {
    this.cache = ctx.cache;
    this.logger = ctx.logger;
    // Held so an internal caller with no request can still be given a
    // reachable target. Both are constructed before this service in
    // bootstrap.cjs, and both are optional: a consumer that always states a
    // URL never reaches the fallback below.
    this.oauth = ctx.oauth;
    this.persistence = ctx.persistence;
    this._cachedConfigKeys = new Set();
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

  /**
   * The connection every configuration read goes over, and the description of
   * it that may be said out loud.
   *
   * One place, because the settings in `AICAConfiguration` describe how the
   * microservice does one job rather than anything about the instance being
   * written to - so they all move together or none of them do. Every other
   * getter on this service reaches Liferay through `getConfig`, which is why
   * this is the only seam that needs to exist. See #824.
   */
  _configurationSource(requestConfig) {
    const resolved = resolveConfigurationSource(requestConfig);
    const connection = this._withReachableTarget(resolved.connection);
    const description = {
      liferayUrl: connection?.liferayUrl ?? resolved.liferayUrl,
      sameAsTarget: resolved.sameAsTarget,
      source: resolved.source,
    };

    this._evictForeignConfigurationCache(description);

    return { connection, description };
  }

  /**
   * A caller that stated no URL must still get a reachable one.
   *
   * The dashboard states its target, so the request paths were correct and
   * the defect was invisible from them. Internal callers - the AI config
   * read, the credential read, the health report - have no request to state
   * it from, so the connection reached the SDK with `liferayUrl: null` and
   * the SDK fell back to the DXP config tree.
   *
   * That tree is not wrong: `com.liferay.lxc.dxp.main.domain` is `localhost`
   * because Liferay is correctly recording its own listener. It is simply
   * not reachable from a different container on the same host, so run
   * 36226890870 spent itself on `ECONNREFUSED 127.0.0.1:443` - 3239 of them
   * against a value that was read successfully every time.
   *
   * `resolveEffectiveLiferayConnection` is the chain that already gets this
   * right for the paths that use it: it rejects a loopback host when the
   * routes tree supplied the credentials, and falls back to
   * `LIFERAY_LXC_DXP_MAIN_DOMAIN`, which the platform puts in the
   * environment. It ran exactly once in that run's log, because nothing on
   * these paths called it. See #1175.
   */
  _withReachableTarget(connection) {
    if (isUsableLiferayUrl(connection?.liferayUrl)) return connection;

    try {
      const effective = resolveEffectiveLiferayConnection(
        connection || {},
        this.oauth,
        this.persistence
      );

      if (!isUsableLiferayUrl(effective?.liferayUrl)) return connection;

      return { ...connection, ...effective };
    } catch (error) {
      // Resolution refusing is not a reason to fail the read here: the SDK
      // still has its own fallback, and the caller's error is more useful
      // than this one. Recorded so it is not silent.
      this.logger?.debug?.(
        `Could not infer a Liferay target for an unstated caller: ${error.message}`,
        { operation: 'liferay-url-resolution' }
      );
      return connection;
    }
  }

  /**
   * The config cache is keyed by config key alone, so a value read from one
   * configuration source would be served for another - which is the #824
   * defect wearing a different hat, since a stale value is just as silent as
   * an invented one. The source that populated the cache is remembered, and a
   * change drops what the previous one put there rather than reusing it.
   */
  _evictForeignConfigurationCache(description) {
    const key = description.sameAsTarget
      ? `same-as-target:${description.liferayUrl || ''}`
      : `config-source:${description.liferayUrl}`;

    if (this._configurationSourceKey === key) return;

    if (this._configurationSourceKey !== undefined) {
      this.logger?.info?.(
        'Configuration source changed; dropping cached configuration',
        {
          operation: 'configuration-source-change',
          from: this._configurationSourceKey,
          to: key,
        }
      );

      for (const cacheKey of this._cachedConfigKeys) {
        this.cache.delete(cacheKey);
      }

      this._cachedConfigKeys.clear();
    }

    this._configurationSourceKey = key;
  }

  /**
   * Remembers what this service put in the shared cache, so a configuration
   * source change can drop exactly that and nothing else. A static list would
   * not do: prompts and schemas are cached under keys built from a name.
   */
  _cacheConfigValue(cacheKey, value) {
    this._cachedConfigKeys.add(cacheKey);
    this.cache.set(cacheKey, value, this.getConfigTTL());
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

    const { connection, description } =
      this._configurationSource(requestConfig);

    const cached = cache.get(cacheKey);
    if (cached !== undefined && cached !== null) {
      return cached;
    }

    let response;
    try {
      response = await liferay.getConfig(connection, configKey);
    } catch (err) {
      const erc = err?.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.errorWithStack?.(err, {
        operation: 'liferay-get-config',
        errorReference: erc,
        configurationSource: description,
        message: `Failed to read config for key "${configKey}"`,
      });
      throw configurationUnavailable(err, description);
    }

    if (response?.items && response.items.length > 0) {
      const rawVal = response.items[0].configValue;
      const parsedValue =
        typeof rawVal === 'string' ? tryParseJSON(rawVal) : rawVal;

      // HARDENING: Never cache the 'EMPTY' placeholder.
      // This ensures we always try to get the real key if it's not yet configured.
      if (parsedValue !== EMPTY_PLACEHOLDER) {
        this._cacheConfigValue(cacheKey, parsedValue);
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
    const prompts = {};

    for (const promptName of listPromptNames()) {
      prompts[promptName] = await this.getAIPrompt(requestConfig, promptName);
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

    // Every key the SDK reads, not the four somebody remembered. `_getExclusions`
    // resolves an unnamed key to `excludeLists[undefined]` and then to `[]`,
    // which is indistinguishable from "nothing was excluded" - on the path that
    // then deletes things. Account groups went unprotected that way for as long
    // as the entity name has been spelled with a hyphen (#951, accelerator-sdk
    // #245), and five more keys were in the same position.
    //
    // Taken from the SDK rather than restated, so a key added there arrives
    // here rather than waiting to be noticed.
    const defaultExcludeLists = {
      ...emptyExcludeLists(),
      // The one seeded default: Liferay's own test account, which a delete run
      // must not remove. Applied over the empty set rather than replacing it.
      excludedAccounts: [{ name: 'Test Test' }],
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

  /**
   * Chunk sizes, from the configuration source, or AICA's own defaults said
   * out loud.
   *
   * Three layers, and only the first two are configuration: the `ai-chunk-sizes`
   * record, then the `chunkSize` carried on `ai-config`, then
   * `DEFAULT_CHUNK_SIZES`. What is gone is the fourth behaviour - a `catch`
   * that turned a failed read into `{ product: 10, ... }`. That made an
   * unreachable configuration source indistinguishable from a deliberate 10,
   * so the panel setting could not be corrected because nothing said it had not
   * been applied. A read that does not complete now refuses. See #824.
   */
  async getAIChunkSizes(requestConfig) {
    const chunkSizes = await this.getConfig(
      requestConfig,
      AI_CHUNK_SIZES_CACHE_KEY,
      AI_CHUNK_SIZES_CONFIG_KEY
    );

    if (chunkSizes && typeof chunkSizes === 'object') {
      const sanitize = (val, task) =>
        Number.isInteger(val) && val >= 1 && val <= 50
          ? val
          : DEFAULT_CHUNK_SIZES[task];

      return {
        product: sanitize(chunkSizes.product, 'product'),
        account: sanitize(chunkSizes.account, 'account'),
        order: sanitize(chunkSizes.order, 'order'),
        warehouse: sanitize(chunkSizes.warehouse, 'warehouse'),
        pricing: sanitize(chunkSizes.pricing, 'pricing'),
      };
    }

    const aiConfig = await this.getAIConfig(requestConfig);
    const configured = aiConfig?.chunkSize;

    if (!configured && !aiConfig?.chunkSizes) {
      this.reportDefaultApplied(requestConfig, 'ai-chunk-sizes', {
        appliedDefault: DEFAULT_CHUNK_SIZES,
      });

      return { ...DEFAULT_CHUNK_SIZES };
    }

    const fallback = configured || DEFAULT_CHUNK_SIZES.product;

    return {
      product: aiConfig?.chunkSizes?.product || fallback,
      account: aiConfig?.chunkSizes?.account || fallback,
      order: aiConfig?.chunkSizes?.order || fallback,
      warehouse: aiConfig?.chunkSizes?.warehouse || fallback,
      pricing: aiConfig?.chunkSizes?.pricing || fallback,
    };
  }

  getAIChunkSizesCached() {
    const cached = this.getConfigCached(AI_CHUNK_SIZES_CACHE_KEY);
    return cached || { ...DEFAULT_CHUNK_SIZES };
  }

  /**
   * Says that a value AICA invented is about to be used, and where AICA looked
   * before inventing it.
   *
   * The harm #824 records is not that a default applied; it is that nothing
   * said so, so a `requestTimeoutMs` of 300000 set in the panel looked applied
   * while the run died at 60s three times over. WARN rather than DEBUG for the
   * same reason `liferayEnv` warns about an inferred target: whatever reaches
   * here was not configured anywhere the operator can see.
   */
  reportDefaultApplied(requestConfig, configKey, detail = {}) {
    let description;

    try {
      description = describeConfigurationSource(requestConfig);
    } catch {
      description = null;
    }

    this.logger?.warn?.(
      `No "${configKey}" configuration was found; AICA's own default applies`,
      {
        operation: 'configuration-default-applied',
        configKey,
        configurationSource: description,
        ...detail,
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

  /**
   * `provider` is passed in rather than looked up: getAIConfig calls this
   * method, so fetching the config here would recurse. Callers that know the
   * provider should supply it; otherwise the cached config is consulted, which
   * is synchronous and cycle-free but may be cold on the first call. A key that
   * ends up mismatched is still caught before it is sent - see apiKeys.cjs.
   */
  async getAIKey(requestConfig, provider) {
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

      // FALLBACK: environment variables. The provider-specific variable is
      // preferred over the generic AI_API_KEY, because AI_API_KEY cannot say
      // which service it belongs to and handing it to the wrong provider
      // discloses it. See apiKeys.cjs.
      const effectiveProvider =
        provider || this.getAIConfigCached()?.provider || null;
      const envVar = providerEnvVar(effectiveProvider);
      const scopedKey = envVar ? ENV[envVar] : null;

      if (scopedKey && scopedKey.trim().length > 0) {
        logger?.debug?.('AI key not found in Liferay, using provider ENV', {
          operation: 'get-ai-key-fallback',
          envVar,
        });
        return scopedKey.trim();
      }

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

      // "Not configured" is a claim about the configuration, and this code
      // never got far enough to make it: the read itself did not complete. The
      // original error already names the instance, so it travels rather than
      // being replaced by a diagnosis nothing here established. See #824, and
      // #950 for the same rule applied to a Basic credential probe.
      if (error?.name === 'ConfigurationSourceUnavailableError') throw error;

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
        const key = await this.getAIKey(requestConfig, aiConfig?.provider);

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

  /**
   * Normalized on the way out, and deliberately: `_getConfigWithFallback`
   * answers `{}` both for an instance provisioned before this entry existed and
   * for a read that failed, and neither may be allowed to read as
   * `neverExpire: false`. See utils/catalogExpiry.cjs and #681.
   */
  async getCatalogExpiryConfig(requestConfig) {
    return normalizeCatalogExpiryConfig(
      await this._getConfigWithFallback(
        requestConfig,
        CATALOG_EXPIRY_CONFIG_CACHE_KEY,
        CATALOG_EXPIRY_CONFIG_KEY,
        'get-catalog-expiry-config',
        'Failed to get catalog expiry configuration'
      )
    );
  }

  /**
   * How long a run's media stays, and whether package staging outlives its
   * package.
   *
   * Normalized on the way out for the same reason the expiry config is: an
   * empty answer means "provisioned before this entry existed" or "the read
   * failed", and neither may resolve to a retention of zero, which would
   * prune every run's media on the next pass. See utils/mediaArchiveConfig.cjs
   * and #917.
   */
  async getMediaArchiveConfig(requestConfig) {
    return normalizeMediaArchiveConfig(
      await this._getConfigWithFallback(
        requestConfig,
        MEDIA_ARCHIVE_CONFIG_CACHE_KEY,
        MEDIA_ARCHIVE_CONFIG_KEY,
        'get-media-archive-config',
        'Failed to get media archive configuration'
      )
    );
  }

  getMediaArchiveConfigCached() {
    return normalizeMediaArchiveConfig(
      this.getConfigCached(MEDIA_ARCHIVE_CONFIG_CACHE_KEY)
    );
  }

  getCatalogExpiryConfigCached() {
    return normalizeCatalogExpiryConfig(
      this.getConfigCached(CATALOG_EXPIRY_CONFIG_CACHE_KEY)
    );
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

  /**
   * The `ai-config` record, read from the configuration source.
   *
   * Two behaviours changed here, and both are the same rule. A read that does
   * not complete now throws instead of returning `null`, because a caller given
   * `null` treats it as `{}` and every AI setting lands on a literal. And when
   * the configuration source answers but holds no record, the result no longer
   * carries an invented `provider: 'openai'` and `defaultModel: 'gpt-4o'` - a
   * key that arrived from ENV is a real value and is kept, but a model nobody
   * chose is not one, so `aicaFallback` travels in its place and
   * `getRuntimeAIConfig` refuses by name rather than running on gpt-4o at chunk
   * size 10. See #824.
   */
  async getAIConfig(requestConfig) {
    const cache = this.cache;
    const liferay = this._requireLiferay();
    const cached = cache.get(AI_CONFIG_CACHE_KEY);
    if (cached) return cached;

    const { connection, description } =
      this._configurationSource(requestConfig);

    let resp;
    try {
      resp = await liferay.getConfig(connection, AI_CONFIG_KEY);
    } catch (error) {
      const erc = error?.errorReference || createERC(ERC_PREFIX.ERROR);
      this.logger?.errorWithStack?.(error, {
        operation: 'get-ai-config',
        errorReference: erc,
        configurationSource: description,
        message: 'Failed to get AI configuration',
      });
      throw configurationUnavailable(error, description);
    }

    const raw = resp?.items?.length ? resp.items[0].configValue : undefined;
    const parsed = typeof raw === 'string' ? tryParseJSON(raw, {}) : raw;
    // A record whose value is not a JSON object carries no settings, which is
    // the same situation as no record at all and is reported the same way. It
    // used to throw here - `parsed.apiKey = ...` on a string - and the throw was
    // swallowed by a `catch` that returned null, so a malformed record looked
    // exactly like a healthy one that had never been read.
    const held = parsed && typeof parsed === 'object' ? parsed : null;

    if (held) {
      held.chunkSize =
        Number.isInteger(held.chunkSize) && held.chunkSize > 0
          ? held.chunkSize
          : DEFAULT_CHUNK_SIZES.product;
    }

    const apiKey = await this.getAIKey(requestConfig);
    const trimmedKey =
      typeof apiKey === 'string' && apiKey.trim().length > 0
        ? apiKey.trim()
        : null;

    if (held) {
      if (trimmedKey) held.apiKey = trimmedKey;
      this._cacheConfigValue(AI_CONFIG_CACHE_KEY, held);
      return held;
    }

    if (trimmedKey) {
      const reason = raw
        ? `the "${AI_CONFIG_KEY}" record does not hold a JSON object`
        : `no "${AI_CONFIG_KEY}" record was found`;

      this.reportDefaultApplied(requestConfig, AI_CONFIG_KEY, {
        appliedDefault: 'an API key only - no provider, model or chunk sizes',
        reason,
      });

      const fallback = {
        apiKey: trimmedKey,
        aicaFallback: { configurationSource: description, reason },
      };
      this._cacheConfigValue(AI_CONFIG_CACHE_KEY, fallback);
      return fallback;
    }

    return null;
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
    const config =
      this.getConfigCached(WORKFLOW_RESILIENCE_CONFIG_CACHE_KEY) || {};
    return {
      initialDelayMs: config.initialDelayMs ?? 5000,
      maxRetries: config.maxRetries ?? 5,
      multiplier: config.multiplier ?? 2,
      deletionConcurrency: config.deletionConcurrency ?? 5,
    };
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
          : DEFAULT_MODEL_OPTIONS;

      // Resolved against the configured provider, so a provider switch cannot
      // leave a foreign model selected.
      const defaultModel = defaultModelForProvider(
        resolvedOptions,
        aiConfig?.provider,
        aiConfig?.defaultModel
      );

      if (defaultModel !== aiConfig?.defaultModel) {
        logger?.warn?.(
          `Default AI model '${aiConfig?.defaultModel}' is not an available option for provider '${aiConfig?.provider}'. Setting default to '${defaultModel}'.`,
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
        aiModelOptions: DEFAULT_MODEL_OPTIONS,
        defaultModel: defaultModelForProvider(
          DEFAULT_MODEL_OPTIONS,
          this.getAIConfigCached()?.provider
        ),
      };
    }
  }

  getAIModelOptionsCached() {
    const cached = this.getConfigCached(AI_MODEL_OPTIONS_CACHE_KEY);
    const cachedAIConfig = this.getAIConfigCached();

    const resolvedOptions =
      Array.isArray(cached) && cached.length > 0
        ? cached
        : DEFAULT_MODEL_OPTIONS;

    const defaultModel = defaultModelForProvider(
      resolvedOptions,
      cachedAIConfig?.provider,
      cachedAIConfig?.defaultModel
    );

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
      this.cache.delete(AI_CONFIG_CACHE_KEY);
    } else if (configKey === AI_MEDIA_CREDENTIALS_CONFIG_KEY) {
      this.cache.delete(AI_MEDIA_API_CACHE_KEY);
    } else if (configKey === AI_CONFIG_KEY) {
      this.cache.delete(AI_CONFIG_CACHE_KEY);
    } else if (configKey === AI_CHUNK_SIZES_CONFIG_KEY) {
      this.cache.delete(AI_CHUNK_SIZES_CACHE_KEY);
    }

    return result;
  }

  async syncEnvironmentKeys() {
    const { lookupConfig } = require('@rotty3000/config-node');
    const logger = this.logger;

    // Resolve Core Key & Provider
    // Priority: OPENAI_API_KEY > GEMINI_API_KEY > ANTHROPIC_API_KEY > AI_API_KEY
    // Anthropic is preferred last among the specific keys because it cannot
    // generate images: a project that sets several is better defaulted to a
    // provider that covers both data and media. See #577.
    //
    // The generic AI_API_KEY is now considered last, not first. It says nothing
    // about which service it belongs to, and this method *persists* the key it
    // picks into the ai-credentials object - so preferring it meant an
    // ambiguous credential outlived the environment variable it came from. When
    // it is the only key available, the provider is inferred from its prefix so
    // it can at least be attributed rather than left unconfigured.
    const { apiKey: coreApiKey, provider: detectedProvider } =
      resolveCoreKey(lookupConfig);

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
            // Taken from the shipped model catalogue rather than a ternary.
            // The previous expression had no anthropic branch, so detecting
            // Anthropic configured gemini-1.5-flash - a pairing aiService now
            // rejects outright, and a model no longer in the shipped list.
            defaultModel: defaultModelForProvider(
              DEFAULT_MODEL_OPTIONS,
              detectedProvider
            ),
            temperature: 0.7,
            maxTokens: DEFAULT_MAX_TOKENS,
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

      for (const promptName of listPromptNames()) {
        const prompt = await this.getAIPrompt(requestConfig, promptName);
        if (!prompt) {
          health.prompts.status = 'WARNING';
          health.prompts.missing.push(promptName);
        }
      }

      for (const schemaName of listSchemaNames()) {
        const schema = await this.getAISchema(requestConfig, schemaName);
        if (!schema) {
          health.schemas.status = 'WARNING';
          health.schemas.missing.push(schemaName);
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
