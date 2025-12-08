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

function maskOpenAIKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return '';
  if (rawKey.length <= 8) return '********';
  return rawKey.slice(0, 4) + '********' + rawKey.slice(-4);
}

module.exports = (app, { logger, configService }) => {
  app.get('/api/config/ai', async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const aiCfg = await configService.getAIConfig(config);
      const promptsCfg = await configService.getAIPromptsConfig(config);

      const openAIKeyRaw = await (async () => {
        try {
          return await configService.getOpenAIKey(config);
        } catch {
          return null;
        }
      })();

      const body = {
        ai: aiCfg || {},
        prompts: promptsCfg || {},
        keyAvailable: !!openAIKeyRaw,
        maskedApiKey: maskOpenAIKey(openAIKeyRaw || ''),
      };

      res.json({
        success: true,
        config: body,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-ai-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get('/api/config/batch-polling', async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const pollingCfg = await configService.getBatchPollingConfig(config);

      res.json({
        success: true,
        config: pollingCfg || {},
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendSafeError(res, logger, req, error, 'get-batch-polling-config', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get('/api/config/cache', async (req, res) => {
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

  app.get('/api/config/queues', async (req, res) => {
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

  app.get('/api/config/oauth', async (req, res) => {
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

  app.get('/api/config/object-storage', async (req, res) => {
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

  app.get('/api/config/ws', async (req, res) => {
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

  app.get('/api/status/openai', async (req, res) => {
    const { config } = buildConfigAndOptions(req);

    try {
      const key = await (async () => {
        try {
          return await configService.getOpenAIKey(config);
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
      sendSafeError(res, logger, req, error, 'get-openai-status', {
        sanitizeConfig: sanitizedObject(config),
      });
    }
  });

  app.get('/api/config/categories', async (req, res) => {
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

      app.get('/api/config/ai-model-options', async (req, res) => {
      const { config } = buildConfigAndOptions(req);
  
      try {
        const { aiModelOptions, defaultModel } = await configService.getAIModelOptions(config);
  
        res.json({
          success: true,
          aiModelOptions: aiModelOptions || [],
          defaultModel,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        sendSafeError(res, logger, req, error, 'get-ai-model-options', {
          sanitizeConfig: sanitizedObject(config),
        });
      }
    });
  app.get('/api/config/batch-sizes', async (req, res) => {
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
  });
};
