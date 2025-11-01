const { lxcConfig, lookupConfig } = require('@rotty3000/config-node');
const { v4: uuidv4 } = require('uuid');
const {
  sanitizedObject,
  parseBatchStatuses,
} = require('../utils/normalize.cjs');
const {
  inferEntityTypeFromClassName,
  delay,
  createERC,
  resolveErrorReference,
  getByValue,
} = require('../utils/misc.cjs');
const { ERC_PREFIX, OP_MAP } = require('../utils/constants.cjs');
const { getBatchCacheTTLms, getLongLivedTTLms } = require('../utils/ttl.cjs');

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

function safeErrorResponse({
  res,
  logger,
  req,
  error,
  operation,
  meta = {},
  statusCode = 500,
  fallbackMessage = 'Unexpected server error',
  getWs,
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

  try {
    if (getWs) {
      getWs().emitError({
        correlationId: req.correlationId,
        batchId: meta?.batchId,
        entityType: meta?.entityType || 'system',
        message,
        phase: operation || 'internal',
        errorReference,
        operation,
        details: {
          route: req.originalUrl || req.url,
        },
      });
    }
  } catch (wsErr) {
    logger.warn?.('Failed to emit WS error notification', {
      operation: 'safeErrorResponse-ws-emitError',
      batchId: meta?.batchId,
      correlationId: req.correlationId,
      wsError: wsErr?.message,
    });
  }

  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      error: message,
      errorReference,
      timestamp: new Date().toISOString(),
    });
  }
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
  function readSafeQuery(req) {
    // Only allow known keys and restrict characters to be SIEM/IDS friendly
    // This route never uses these values in SQL, but we keep them strict to avoid WAF false-positives.
    const ALLOWED = new Set(['sessionId', 'batchERC', 'opCode', 'entity']);
    const SAFE_RE = /^[a-zA-Z0-9._:-]+$/; // no spaces or SQL keywords to trip naive WAFs
    const out = {};
    for (const [k, v] of Object.entries(req.query || {})) {
      if (!ALLOWED.has(k)) continue;
      const str = String(v || '').trim();
      out[k] = SAFE_RE.test(str) ? str : undefined;
    }
    return out;
  }
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
      err.errorReference =
        resolveErrorReference(e) || createERC(ERC_PREFIX.ERROR);
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
    const { sessionId: qsSessionId, batchERC: qsBatchERC, opCode: qsOpCode, entity: qsEntity } = readSafeQuery(req);
    const batchOp = qsOpCode ? getByValue(OP_MAP, qsOpCode) : undefined;

    const [{ batchId: bid, status } = {}] = parseBatchStatuses(req.body) || [{}];
    const batchId = bid != null ? String(bid) : undefined;

    res.status(200).json({
      success: true,
      message: 'Batch callback received',
      batchId,
      status,
    });
    if (!batchId || batchId === 'undefined' || batchId === 'null') {
      logger.warn('Batch callback missing batchId in payload', {
        operation: 'batch-callback-missing-batchId',
        query: {
          sessionId: qsSessionId || 'n/a',
          batchERC: qsBatchERC || 'n/a',
          opCode: qsOpCode || 'n/a',
          entity: qsEntity || 'n/a',
        },
        bodyKeys: req.body ? Object.keys(req.body) : [],
      });
      return;
    }

    logger.debug('Batch callback', {
      sessionId: qsSessionId || 'n/a',
      batchERC: qsBatchERC || 'n/a',
      opCode: qsOpCode || 'n/a',
      op: batchOp || 'n/a',
      entity: qsEntity || 'n/a',
    });

    let correlationId;
    let batchConfig;
    try {
      const ttlLong = getLongLivedTTLms(configService);
      const ttlBatch = getBatchCacheTTLms(configService);

      let batchERC = qsBatchERC;
      if (!batchERC) {
        const mapped = cacheService.get(`batch:${batchId}:erc`);
        if (mapped?.externalReferenceCode)
          batchERC = mapped.externalReferenceCode;
      }

      if (batchERC) {
        const ercCfg = cacheService.get(`erc:${batchERC}:config`);
        if (ercCfg) {
          batchConfig = ercCfg;
          correlationId = ercCfg.correlationId;
        }

        if (!cacheService.get(`erc:${batchERC}:batchId`)) {
          cacheService.set(`erc:${batchERC}:batchId`, batchId, ttlLong);
        }
        if (!cacheService.get(`batch:${batchId}:erc`)) {
          cacheService.set(
            `batch:${batchId}:erc`,
            { externalReferenceCode: batchERC },
            ttlLong
          );
        }
      }

      // Rehydrate and resolve item ERCs from cache, and persist them under both keys for future callbacks
      let itemERCs;
      if (batchERC) {
        itemERCs = cacheService.get(`erc:${batchERC}:itemERCs`);
      }
      if ((!Array.isArray(itemERCs) || itemERCs.length === 0) && batchId) {
        const byBatch = cacheService.get(`batch:${batchId}:itemERCs`);
        if (Array.isArray(byBatch) && byBatch.length > 0) {
          itemERCs = byBatch;
        }
      }
      if (
        (!Array.isArray(itemERCs) || itemERCs.length === 0) &&
        qsSessionId &&
        batchERC
      ) {
        const sessKey = `session:${qsSessionId}:itemERCsByBatch:${batchERC}`;
        const bySession = cacheService.get(sessKey);
        if (Array.isArray(bySession) && bySession.length > 0) {
          itemERCs = bySession;
        }
      }
      if (Array.isArray(itemERCs) && itemERCs.length > 0) {
        if (batchId && !cacheService.get(`batch:${batchId}:itemERCs`)) {
          cacheService.set(`batch:${batchId}:itemERCs`, itemERCs, ttlLong);
        }
        if (batchERC && !cacheService.get(`erc:${batchERC}:itemERCs`)) {
          cacheService.set(`erc:${batchERC}:itemERCs`, itemERCs, ttlLong);
        }
      } else {
        logger.warn('No item ERCs found for batch; will rely on later rehydration', {
          operation: 'batch-itemercs-miss',
          batchId,
          batchERC: batchERC || 'n/a',
          sessionId: qsSessionId || 'n/a',
        });
      }

      if (!batchConfig) {
        batchConfig = await waitForConfig(batchId, {
          tries: 7,
          min: 35,
          max: 900,
        });
        if (!batchConfig) {
          logger.warn('No config found for batch, attempting recovery', {
            operation: 'batch-callback-no-config',
            batchId,
            sessionId: qsSessionId,
            batchERC: batchERC || 'n/a',
          });

          let recovered = await restoreConfig(batchId, uuidv4());

          if (!recovered && (batchERC || qsBatchERC)) {
            const ercKey = `erc:${batchERC || qsBatchERC}:config`;
            const ercConfig = cacheService.get(ercKey);
            if (ercConfig) {
              recovered = ercConfig;
              logger.info('Recovered batch config via ERC key', {
                operation: 'batch-callback-recovered-erc',
                batchId,
                ercKey,
              });
            }
          }

          if (recovered) {
            batchConfig = recovered;
            correlationId = recovered.correlationId;
          }
        } else {
          correlationId = batchConfig.correlationId;
        }
      }

      {
        const metaKey = `batch:${batchId}:meta`;
        const existingMeta = cacheService.get(metaKey) || {};
        cacheService.set(
          metaKey,
          {
            ...existingMeta,
            sessionId: existingMeta.sessionId || qsSessionId,
            batchERC: existingMeta.batchERC || batchERC || qsBatchERC,
          },
          ttlBatch
        );

        cacheService.set(
          `batch:${batchId}:submission`,
          {
            correlationId,
            status,
            entityType: batchConfig?.entityType || 'unknown',
            submittedAt: new Date().toISOString(),
            rawCallback: req.body,
            sessionId: qsSessionId,
            batchERC: batchERC || qsBatchERC,
            itemERCs: Array.isArray(itemERCs) ? itemERCs : undefined
          },
          ttlBatch
        );
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
        rawQuerySessionId: qsSessionId,
        rawQueryBatchERC: qsBatchERC,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        sessionId: qsSessionId,
        batchERC: batchERC || qsBatchERC,
      });

      if (logger.isTraceEnabled?.()) {
        const sanitizedCallback = sanitizedObject({ ...req.body });
        logger.trace(
          [
            '=== BATCH SUBMISSION CALLBACK ===',
            `Batch ID: ${batchId || 'Not provided'}`,
            `Status: ${status || 'Not provided'}`,
            `Query.sessionId: ${qsSessionId || 'n/a'}`,
            `Query.batchERC: ${batchERC || qsBatchERC || 'n/a'}`,
            `Full callback data: ${JSON.stringify(sanitizedCallback, null, 2)}`,
            '=== END CALLBACK ===',
          ].join('\n')
        );
      }

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
            const ref =
              resolveErrorReference(err) || createERC(ERC_PREFIX.ERROR);
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

            getWs().emitError({
              correlationId,
              batchId,
              entityType,
              message: err.message || 'Batch processing error',
              phase: 'batch-polling',
              errorReference: ref,
              operation: batchConfig.operation || 'batch-error',
              details: { status: 'FAILED' },
            });
          },
        });
        return;
      }

      let finalProcessed;
      let finalTotal;
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

      if (status === 'COMPLETED') {
        cacheService.set(
          `batch:${batchId}:final`,
          {
            status: 'COMPLETED',
            entityType,
            processedCount: finalProcessed ?? 0,
            totalCount: finalTotal ?? finalProcessed ?? 0,
            completedAt: new Date().toISOString(),
            correlationId,
          },
          ttlBatch
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
        const msg = 'Batch failed';
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
          ttlBatch
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

        getWs().emitError({
          correlationId,
          batchId,
          entityType,
          message: msg,
          phase: 'batch-final',
          errorReference: createERC(ERC_PREFIX.ERROR),
          operation: batchConfig.operation || 'batch-failed',
          details: {
            status: 'FAILED',
            processedCount: finalProcessed ?? 0,
            totalCount: finalTotal ?? finalProcessed ?? 0,
          },
        });

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
          entityType: (batchConfig && batchConfig.entityType) || 'unknown',
          requestBody: sanitizedObject(req.body),
        },
        statusCode: 500,
        fallbackMessage: 'Failed to process batch callback',
        getWs,
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
          entityType: 'system',
        },
        statusCode: 500,
        fallbackMessage: 'Failed to get batch status',
        getWs,
      });
    }
  });
};
