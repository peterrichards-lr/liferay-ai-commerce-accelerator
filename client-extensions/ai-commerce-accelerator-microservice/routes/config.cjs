const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const {
  buildConfigAndOptions,
  sanitizedObject,
} = require('../utils/normalize.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

function sendSafeError(res, logger, req, error, operation, meta = {}) {
  const existingRef = resolveErrorReference(error);
  const errorReference = existingRef || createERC(ERC_PREFIX.ERROR);

  const message =
    (error && error.message) ||
    (typeof error === 'string' ? error : null) ||
    'Unknown error while retrieving configuration';

  logger.errorWithStack(error, {
    errorReference,
    operation,
    correlationId: req.correlationId,
    errorMessage: message,
    requestDetails: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    },
    ...meta,
  });

  res.status(500).json({
    success: false,
    error: message,
    errorReference,
    timestamp: new Date().toISOString(),
  });
}

function maskAIKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return '';
  if (rawKey.length <= 8) return '********';
  return rawKey.slice(0, 4) + '********' + rawKey.slice(-4);
}

module.exports = (app, { logger, configService, persistenceService }) => {
  const handleConfigAI = async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const aiCfg = await configService.getAIConfig(config);
      const promptsCfg = await configService.getAIPromptsConfig(config);

      const aiKeyRaw = await (async () => {
        try {
          return await configService.getAIKey(config);
        } catch {
          return null;
        }
      })();

      const mediaKeyRaw = await (async () => {
        try {
          return await configService.getAIMediaKey(config);
        } catch {
          return null;
        }
      })();

      const body = {
        ai: aiCfg || {},
        prompts: promptsCfg || {},
        keyAvailable: !!aiKeyRaw,
        mediaKeyAvailable: !!mediaKeyRaw,
        maskedApiKey: maskAIKey(aiKeyRaw || ''),
        maskedMediaApiKey: maskAIKey(mediaKeyRaw || ''),
      };

      // Retrieve persisted cli_config and generationConfig from SQLite
      let generationConfig = {};
      const savedGenConfigRaw =
        persistenceService?.getSystemSetting('generation_config');
      if (savedGenConfigRaw) {
        try {
          generationConfig = JSON.parse(savedGenConfigRaw);
        } catch {
          generationConfig = {};
        }
      }

      let savedCliConfig = {};
      const savedCliConfigRaw =
        persistenceService?.getSystemSetting('cli_config');
      if (savedCliConfigRaw) {
        try {
          savedCliConfig = JSON.parse(savedCliConfigRaw);
        } catch {
          savedCliConfig = {};
        }
      }

      res.json({
        success: true,
        config: {
          ...body,
          ...savedCliConfig,
        },
        generationConfig,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-ai-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  };

  app.get(INTERNAL_API_PATHS.CONFIG_AI, handleConfigAI);
  app.post(INTERNAL_API_PATHS.CONFIG_AI, handleConfigAI);

  app.get(INTERNAL_API_PATHS.CONFIG_CACHE, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const cacheCfg = await configService.getCacheConfig(config);

      res.json({
        success: true,
        config: cacheCfg || {},
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-cache-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_QUEUES, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const queueCfg = await configService.getQueueConfig(config);

      res.json({
        success: true,
        config: queueCfg || {},
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-queue-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_OAUTH, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const oauthCfg = await configService.getOAuthConfig(config);

      const safeOauthCfg = {
        httpTimeoutMs: oauthCfg?.httpTimeoutMs,
        maxRetries: oauthCfg?.maxRetries,
        backoffBaseMs: oauthCfg?.backoffBaseMs,
        tokenSkewSec: oauthCfg?.tokenSkewSec,
        tokenCacheTtlMs: oauthCfg?.tokenCacheTtlMs,
      };

      res.json({
        success: true,
        config: safeOauthCfg,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-oauth-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_OBJECT_STORAGE, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const objCfg = await configService.getObjectStorageConfig(config);

      const safeObjCfg = {
        signedUrlTtlSec: objCfg?.signedUrlTtlSec,
        uploadPrefix: objCfg?.uploadPrefix,
        sidecarEndpoint: objCfg?.sidecarEndpoint ? '[configured]' : undefined,
      };

      res.json({
        success: true,
        config: safeObjCfg,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-object-storage-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_WS, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const wsCfg = await configService.getWSConfig(config);

      res.json({
        success: true,
        config: wsCfg || {},
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-ws-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.STATUS_OPENAI, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const key = await (async () => {
        try {
          return await configService.getAIKey(config);
        } catch {
          return null;
        }
      })();

      res.json({
        success: true,
        keyAvailable: !!key,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-ai-status', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_CATEGORIES, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const categories = await configService.getCategories(config);

      res.json({
        success: true,
        categories: categories || [],
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-categories-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_AI_MODEL_OPTIONS, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const { aiModelOptions, defaultModel } =
        await configService.getAIModelOptions(config);

      res.status(200).json({
        aiModelOptions,
        defaultModel,
        success: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-ai-model-options', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_HEALTH, async (req, res) => {
    const { config } = buildConfigAndOptions(req);
    try {
      const health = await configService.checkHealth(config);
      res.status(200).json({
        success: true,
        health,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-config-health', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });
  const handleBatchSizes = async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const batchSizes = await configService.getBatchSizes(config);

      res.json({
        success: true,
        batchSizes: batchSizes || [],
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-batch-sizes', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  };

  app.get(INTERNAL_API_PATHS.CONFIG_BATCH_SIZES, handleBatchSizes);
  app.post(INTERNAL_API_PATHS.CONFIG_BATCH_SIZES, handleBatchSizes);

  app.post('/config/save', async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      if (req.body.generationConfig) {
        persistenceService?.saveSystemSetting(
          'generation_config',
          JSON.stringify(req.body.generationConfig)
        );
      }

      if (req.body.config) {
        persistenceService?.saveSystemSetting(
          'cli_config',
          JSON.stringify(req.body.config)
        );

        if (req.body.config.liferayUrl) {
          persistenceService?.saveSystemSetting(
            'active_liferay_url',
            req.body.config.liferayUrl
          );
        }
        if (req.body.config.clientId) {
          persistenceService?.saveSystemSetting(
            'active_client_id',
            req.body.config.clientId
          );
        }
        if (req.body.config.clientSecret) {
          persistenceService?.saveSystemSetting(
            'active_client_secret',
            req.body.config.clientSecret
          );
        }
      }

      configService.clearCache();

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'save-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_EXCLUDE_LISTS, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const excludeLists = await configService.getExcludeLists(config);

      res.json({
        success: true,
        excludeLists: excludeLists || {},
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-exclude-lists', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get(INTERNAL_API_PATHS.CONFIG_GENERATION_LIMITS, async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const limits = await configService.getGenerationLimits(config);

      res.json({
        success: true,
        limits: limits || {},
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-generation-limits', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });
};
