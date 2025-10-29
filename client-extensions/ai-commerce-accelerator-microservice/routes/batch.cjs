const { lxcConfig, lookupConfig } = require('@rotty3000/config-node');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const {
  sanitizedObject,
  parseBatchStatuses,
} = require('../utils/normalize.cjs');
const { inferEntityTypeFromClassName, delay } = require('../utils/misc.cjs');
const { BATCH_FAILED } = require('../utils/wsEvents.cjs');

function buildRecoveredConfig({ liferayUrl, task, correlationId }) {
  return {
    correlationId,
    entityType: inferEntityTypeFromClassName(task?.className) || 'unknown',
    liferayUrl,
    localeCode: 'en-US',
    maxPollAttempts: 120,
    mode: 'generate',
    pollInterval: 5000,
    operation: 'generate',
    affectsProgress: true,
  };
}

module.exports = (
  app,
  { cacheService, batchPollingService, liferayService, logger, getWs }
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
      throw new Error(`Unable to determine Liferay URL: ${e?.message || e}`);
    }

    return {
      liferayUrl,
      task: await liferayService.getImportTask({ liferayUrl }, batchId),
    };
  };

  const restoreConfig = async (batchId, correlationId) => {
    try {
      const { liferayUrl, task } = await getImportTask(batchId);
      const cfg = buildRecoveredConfig({ liferayUrl, task, correlationId });
      cacheService.set(`batch:${batchId}:config`, cfg, 60 * 60 * 1000);
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
      });
      return null;
    }
  };

  app.post('/api/batch/callback', async (req, res) => {
    const [
      { batchId: bid, status, processedCount, totalCount, errorMessage } = {},
    ] = parseBatchStatuses(req.body) || [{}];

    const batchId = String(bid);

    let correlationId = undefined;
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
        const trace = `
=== BATCH SUBMISSION CALLBACK ===
Batch ID: ${batchId || 'Not provided'}
Status: ${status || 'Not provided'}
Full callback data: ${JSON.stringify(sanitizedCallback, null, 2)}
=== END CALLBACK ===
`;
        logger.trace(trace);
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
        60 * 60 * 1000
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

        const pollInterval = Math.max(batchConfig?.pollInterval || 5000, 2000);
        const maxPollAttempts = batchConfig?.maxPollAttempts || 120;

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
            logger.error('Batch processing error', {
              operation: 'batch-error',
              batchId,
              entityType,
              error: err.message,
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
          60 * 60 * 1000
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
          affectsProgress &&
          operation === 'generate' &&
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
          60 * 60 * 1000
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
          affectsProgress &&
          operation === 'generate' &&
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
      logger.error('Error processing batch callback', {
        operation: 'batch-callback',
        error: error.message,
        stack: error.stack,
      });
      if (!res.headersSent) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to process batch callback' });
      }
    }
  });

  app.get('/api/batch/:batchId/status', async (req, res) => {
    try {
      const { batchId } = req.params;

      const finalResults = cacheService.get(`batch:${batchId}:final`);
      if (finalResults) {
        return res.json({
          success: true,
          batchId,
          ...finalResults,
          isFinal: true,
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
        });
      }

      res
        .status(404)
        .json({ success: false, error: 'Batch not found or expired' });
    } catch (error) {
      logger.errorWithStack?.(error, {
        correlationId: req.correlationId,
        operation: 'get-batch-status',
        batchId: req.params.batchId,
      });
      res
        .status(500)
        .json({ success: false, error: 'Failed to get batch status' });
    }
  });
};
