const { lxcConfig, lookupConfig } = require('@rotty3000/config-node');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const {
  sanitizedObject,
  parseBatchStatuses,
} = require('../utils/normalize.cjs');
const {
  inferEntityTypeFromClassName,
  delay,
  createERC,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

function resolveErrorReference(err) {
  if (!err || typeof err !== 'object') return null;
  if (err.errorReference && typeof err.errorReference === 'string') {
    return err.errorReference;
  }
  if (err.errorRef && typeof err.errorRef === 'string') {
    return err.errorRef;
  }
  if (err.erc && typeof err.erc === 'string') {
    return err.erc;
  }
  return null;
}

function safeErrorResponse({
  res,
  logger,
  req,
  error,
  operation,
  meta = {},
  statusCode = 500,
  fallbackMessage = 'Unexpected server error',
}) {
  const existingERC = resolveErrorReference(error);
  const errorReference = existingERC || createERC(ERC_PREFIX.ERROR);

  const message =
    (error && error.message) ||
    (typeof error === 'string' ? error : null) ||
    fallbackMessage;

  logger.errorWithStack?.(error, {
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

  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      error: message,
      errorReference,
      timestamp: new Date().toISOString(),
    });
  }
}

// pulls config with sane fallbacks and clamps
function getBatchPollingDefaults(configService) {
  const cfg = configService.getBatchPollingConfigCached() || {};
  const pollInterval = Number.isFinite(cfg.pollInterval)
    ? cfg.pollInterval
    : 5000;
  const maxPollAttempts = Number.isFinite(cfg.maxPollAttempts)
    ? cfg.maxPollAttempts
    : 120;
  return { pollInterval, maxPollAttempts };
}

function getBatchCacheTTLms(configService) {
  const cacheCfg = configService.getCacheConfigCached() || {};
  // if we have a cleanupInterval or jobTTL-like value, prefer something >= 1h
  // otherwise default to 1h
  const oneHour = 60 * 60 * 1000;
  const ttl =
    (Number.isFinite(cacheCfg.apiResponseTTL) && cacheCfg.apiResponseTTL >= oneHour
      ? cacheCfg.apiResponseTTL
      : cacheCfg.configTTL && cacheCfg.configTTL >= oneHour
      ? cacheCfg.configTTL
      : oneHour);
  return ttl;
}

function buildRecoveredConfig({
  liferayUrl,
  task,
  correlationId,
  configService,
}) {
  const { pollInterval, maxPollAttempts } =
    getBatchPollingDefaults(configService);

  return {
    correlationId,
    entityType: inferEntityTypeFromClassName(task?.className) || 'unknown',
    liferayUrl,
    localeCode: 'en-US',
    maxPollAttempts,
    mode: 'generate',
    pollInterval,
    operation: 'generate',
    affectsProgress: true,
  };
}

module.exports = (
  app,
  {
    cacheService,
    batchPollingService,
    liferayService,
    logger,
    getWs,
    configService,
  }
) => {
  const waitForConfig = async (
    batchId,
    { tries = 6, min = 40, max = 800 } = {}
  ) => {
    for (let i = 0; i < tries; i++) {
      const cfg = cacheService.get(`batch:${batchId}:config`);
      if (cfg) return cfg;
      const base = Math.min(max, Math.floor(min * Math.pow(1.7, i)));
      const jitter = Math.floor(base * (0.25 + Math.random() * 0.5));
      await delay(jitter);
    }
    return null;
  };

  const getImportTask = async (batchId) => {
    let liferayUrl;
    try {
      const liferayServerProtocol = lookupConfig(
        'com.liferay.lxc.dxp.server.protocol'
      );
      const liferayServerDomain = lxcConfig.dxpMainDomain();
      liferayUrl = `${liferayServerProtocol}://${liferayServerDomain}`;
      new URL(liferayUrl);
    } catch (e) {
      const err = new Error(
        `Unable to determine Liferay URL: ${e?.message || String(e)}`
      );
      err.errorReference = resolveErrorReference(e) || createERC(ERC_PREFIX.ERROR);
      throw err;
    }

    const task = await liferayService.getImportTask({ liferayUrl }, batchId);
    return { liferayUrl, task };
  };

  const restoreConfig = async (batchId, correlationId) => {
    try {
      const { liferayUrl, task } = await getImportTask(batchId);
      const cfg = buildRecoveredConfig({
        liferayUrl,
        task,
        correlationId,
        configService,
      });
      cacheService.set(
        `batch:${batchId}:config`,
        cfg,
        getBatchCacheTTLms(configService)
      );
      logger.info('Recovered batch config from import task', {
        operation: 'batch-config-recovered',
        batchId,
        entityType: cfg.entityType,
      });
      return cfg;
    } catch (e) {
      logger.error('Failed to recover batch config', {
        operation: 'batch-config-recover-error',
        batchId,
        error: e.message,
        errorReference: resolveErrorReference(e),
      });
      return null;
    }
  };

  app.post('/api/batch/callback', async (req, res) => {
    const [
      {
        batchId: bid,
        status,
        processedCount,
        totalCount,
        errorMessage,
      } = {},
    ] = parseBatchStatuses(req.body) || [{}];

    const batchId = String(bid);

    let correlationId;
    let batchConfig = null;

    try {
      res.status(200).json({
        success: true,
        message: 'Batch callback received',
        batchId,
        status,
      });

      if (!batchId) return;

      batchConfig = await waitForConfig(batchId, {
        tries: 7,
        min: 35,
        max: 900,
      });

      if (!batchConfig) {
        logger.warn('No config found for batch, attempting recovery', {
          operation: 'batch-callback-no-config',
          batchId,
        });

        const recovered = await restoreConfig(batchId, uuidv4());
        if (recovered) {
          batchConfig = recovered;
          correlationId = recovered.correlationId;
        }
      } else {
        correlationId = batchConfig.correlationId;
      }

      const entityType = batchConfig?.entityType || 'unknown';
      const operation = batchConfig?.operation || 'unknown';
      const affectsProgress = batchConfig?.affectsProgress ?? true;

      logger.info('Received batch submission callback from Liferay', {
        correlationId,
        operation: 'batch-callback',
        batchId,
        entityType,
        status,
        bodyKeys: req.body ? Object.keys(req.body) : [],
      });

      if (logger.isTraceEnabled?.()) {
        const sanitizedCallback = sanitizedObject({ ...req.body });
        logger.trace(
          [
            '=== BATCH SUBMISSION CALLBACK ===',
            `Batch ID: ${batchId || 'Not provided'}`,
            `Status: ${status || 'Not provided'}`,
            `Full callback data: ${JSON.stringify(
              sanitizedCallback,
              null,
              2
            )}`,
            '=== END CALLBACK ===',
          ].join('\n')
        );
      }

      cacheService.set(
        `batch:${batchId}:submission`,
        {
          correlationId,
          status,
          entityType,
          submittedAt: new Date().toISOString(),
          rawCallback: req.body,
        },
        getBatchCacheTTLms(configService)
      );

      if (status === 'INITIAL' || status === 'STARTED') {
        if (
          cacheService.get(`batch:${batchId}:completed`) ||
          batchPollingService.isPolling(batchId)
        ) {
          logger.info('Skipping polling start; already completed or active', {
            operation: 'batch-polling-skip',
            batchId,
            entityType,
          });
          return;
        }

        const { pollInterval, maxPollAttempts } =
          getBatchPollingDefaults(configService);

        logger.debug('Starting batch polling', {
          operation: 'batch-polling-start',
          batchId,
          pollInterval,
          maxPollAttempts,
          correlationId,
          entityType,
        });

        batchPollingService.startPolling(batchId, batchConfig, {
          pollInterval,
          maxPollAttempts,
          onStatusChange: (u) => {
            logger.debug('Batch status update', {
              operation: 'batch-status-update',
              batchId,
              status: u.status,
              processedCount: u.processedCount,
              totalCount: u.totalCount,
              entityType,
            });
          },
          onComplete: (r) => {
            logger.info('Batch processing completed', {
              operation: 'batch-complete',
              batchId,
              entityType,
              processedCount: r.processedCount,
              totalCount: r.totalCount,
            });

            getWs().emitBatchCompleted(
              {
                batchId,
                entityType,
                successCount: r.processedCount || 0,
                failureCount: Math.max(
                  (r.totalCount || 0) - (r.processedCount || 0),
                  0
                ),
                totalCount: r.totalCount,
                operation: batchConfig.operation,
              },
              { correlationId }
            );

            logger.info(
              `✅ Batch ${batchId} (${entityType}) completed - ${r.processedCount}/${r.totalCount} items processed`
            );
          },
          onError: (err) => {
            const ref = resolveErrorReference(err) || createERC(ERC_PREFIX.ERROR);

            logger.error('Batch processing error', {
              operation: 'batch-error',
              batchId,
              entityType,
              error: err.message,
              errorReference: ref,
            });

            getWs().emitBatchFailed(
              {
                batchId,
                entityType,
                error: err.message,
                successCount: 0,
                failureCount: 1,
                operation: batchConfig.operation,
              },
              { correlationId }
            );
          },
        });

        return;
      }

      let finalProcessed = processedCount;
      let finalTotal = totalCount;

      if (finalProcessed == null || finalTotal == null) {
        try {
          const { task } = await getImportTask(batchId);
          finalProcessed =
            finalProcessed ??
            task?.processedItemsCount ??
            task?.data?.processedItemsCount;
          finalTotal =
            finalTotal ?? task?.totalItemsCount ?? task?.data?.totalItemsCount;
        } catch (e) {
          logger.warn('Unable to enrich terminal batch counts from task', {
            operation: 'batch-enrich-miss',
            batchId,
            error: e.message,
            errorReference: resolveErrorReference(e),
          });
        }
      }

      if (status === 'COMPLETED') {
        cacheService.set(
          `batch:${batchId}:final`,
          {
            status: 'COMPLETED',
            entityType,
            processedCount: finalProcessed ?? 0,
            totalCount: finalTotal ?? finalProcessed ?? 0,
            completedAt: new Date().toISOString(),
          },
          getBatchCacheTTLms(configService)
        );

        getWs().emitBatchCompleted(
          {
            batchId,
            entityType,
            successCount: finalProcessed ?? 0,
            failureCount: Math.max(
              (finalTotal ?? 0) - (finalProcessed ?? 0),
              0
            ),
            totalCount: finalTotal ?? finalProcessed ?? 0,
            operation: batchConfig.operation,
          },
          { correlationId }
        );

        if (
          (batchConfig.affectsProgress ?? true) &&
          batchConfig.operation === 'generate' &&
          entityType === 'products'
        ) {
          batchPollingService.markBatchCompleteInSessions(
            batchId,
            correlationId
          );
        }

        logger.info(
          `✅ Batch ${batchId} (${entityType}) completed - ${
            finalProcessed ?? 0
          }/${finalTotal ?? finalProcessed ?? 0} items processed`
        );
        return;
      }

      if (status === 'FAILED') {
        const msg = errorMessage || 'Batch failed';

        cacheService.set(
          `batch:${batchId}:final`,
          {
            status: 'FAILED',
            entityType,
            processedCount: finalProcessed ?? 0,
            totalCount: finalTotal ?? finalProcessed ?? 0,
            errorMessage: msg,
            completedAt: new Date().toISOString(),
          },
          getBatchCacheTTLms(configService)
        );

        getWs().emitBatchFailed(
          {
            batchId,
            entityType,
            error: msg,
            successCount: finalProcessed ?? 0,
            failureCount: Math.max(
              (finalTotal ?? 0) - (finalProcessed ?? 0),
              0
            ),
            operation: batchConfig.operation,
          },
          { correlationId }
        );

        if (
          (batchConfig.affectsProgress ?? true) &&
          batchConfig.operation === 'generate' &&
          entityType === 'products'
        ) {
          batchPollingService.markBatchCompleteInSessions(
            batchId,
            correlationId
          );
        }

        logger.error(
          `❌ Batch ${batchId} (${entityType}) failed — processed=${
            finalProcessed ?? 0
          }/${finalTotal ?? finalProcessed ?? 0} — ${msg}`
        );
        return;
      }
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'batch-callback',
        meta: {
          batchId,
          correlationId,
          requestBody: sanitizedObject(req.body),
        },
        statusCode: 500,
        fallbackMessage: 'Failed to process batch callback',
      });
    }
  });

  app.get('/api/batch/:batchId/status', async (req, res) => {
    const { batchId } = req.params;

    try {
      const finalResults = cacheService.get(`batch:${batchId}:final`);
      if (finalResults) {
        return res.json({
          success: true,
          batchId,
          ...finalResults,
          isFinal: true,
          timestamp: new Date().toISOString(),
        });
      }

      const currentStatus = cacheService.get(`batch:${batchId}:status`);
      if (currentStatus) {
        const pollingStatus = batchPollingService.getPollingStatus(batchId);
        return res.json({
          success: true,
          batchId,
          ...currentStatus,
          polling: pollingStatus,
          isFinal: false,
          timestamp: new Date().toISOString(),
        });
      }

      const submissionData = cacheService.get(`batch:${batchId}:submission`);
      if (submissionData) {
        return res.json({
          success: true,
          batchId,
          ...submissionData,
          status: 'SUBMITTED',
          isFinal: false,
          timestamp: new Date().toISOString(),
        });
      }

      const errorReference = createERC(ERC_PREFIX.ERROR);

      logger.warn('Batch not found or expired', {
        errorReference,
        operation: 'get-batch-status',
        correlationId: req.correlationId,
        batchId,
      });

      res.status(404).json({
        success: false,
        error: 'Batch not found or expired',
        errorReference,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      safeErrorResponse({
        res,
        logger,
        req,
        error,
        operation: 'get-batch-status',
        meta: {
          batchId,
        },
        statusCode: 500,
        fallbackMessage: 'Failed to get batch status',
      });
    }
  });
};