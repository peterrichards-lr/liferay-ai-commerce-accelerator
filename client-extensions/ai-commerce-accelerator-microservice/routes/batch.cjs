const { lxcConfig, lookupConfig } = require('@rotty3000/config-node');
const WebSocket = require('ws');
const { get: getWs } = require('../services/wsBus.cjs');
const { cacheService } = require('../services/cacheService.cjs');
const {
  sanitizedObject,
  parseBatchStatuses,
} = require('../utils/normalize.cjs');
const { inferEntityTypeFromClassName, delay } = require('../utils/misc.cjs');

function buildRecoveredConfig({ liferayUrl, task, correlationId }) {
  return {
    liferayUrl,
    localeCode: 'en-US',
    entityType: inferEntityTypeFromClassName(task?.className),
    mode: 'delete',
    correlationId,
    pollInterval: 5000,
    maxPollAttempts: 120,
  };
}

module.exports = function (app, liferayService, batchPollingService, logger) {
  waitForConfig = async (batchId, { tries = 6, min = 40, max = 800 } = {}) => {
    for (let i = 0; i < tries; i++) {
      const cfg = cacheService.get(`batch:${batchId}:config`);
      if (cfg) return cfg;
      const base = Math.min(max, Math.floor(min * Math.pow(1.7, i)));
      const jitter = Math.floor(base * (0.25 + Math.random() * 0.5));
      await delay(jitter);
    }
    return null;
  };

  app.post('/api/batch/callback', async (req, res) => {
    const [{ batchId, status, correlationId }] = parseBatchStatuses(req.body);

    try {
      logger.info('Received batch submission callback from Liferay', {
        correlationId,
        operation: 'batch-callback',
        batchId,
        status,
        bodyKeys: req.body ? Object.keys(req.body) : [],
      });

      if (logger.isDebugEnabled()) {
        logger.debug('=== BATCH SUBMISSION CALLBACK ===');
        logger.debug('Batch ID:', batchId || 'Not provided');
        logger.debug('Status:', status || 'Not provided');
        const sanitizedCallback = sanitizedObject({ ...req.body });
        logger.debug('Full callback data:', { payload: sanitizedCallback });
        logger.debug('=== END CALLBACK ===');
      }

      if (batchId) {
        cacheService.set(
          `batch:${batchId}:submission`,
          {
            status,
            submittedAt: new Date().toISOString(),
            rawCallback: req.body,
          },
          60 * 60 * 1000
        );
      }

      res.status(200).json({
        success: true,
        message: 'Batch callback received',
        batchId,
        status,
      });

      if (!batchId) return;

      let batchConfig = await waitForConfig(batchId, {
        tries: 7,
        min: 35,
        max: 900,
      });

      if (!batchConfig) {
        logger.warn('No config found for batch, attempting recovery', {
          operation: 'batch-callback-no-config',
          batchId,
        });

        try {
          let liferayUrl;
          try {
            const liferayServerPorotocl = lookupConfig(
              'com.liferay.lxc.dxp.server.protocol'
            );
            const liferayServerDomain = lxcConfig.dxpMainDomain();
            liferayUrl = `${liferayServerPorotocl}://${liferayServerDomain}`;
            new URL(liferayUrl);
          } catch (e) {
            throw new Error('Unable to determine liferay URL', e);
          }

          const task = await liferayService.getImportTask(
            { liferayUrl },
            batchId
          );
          batchConfig = buildRecoveredConfig({
            liferayUrl,
            task,
            correlationId,
          });

          cacheService.set(
            `batch:${batchId}:config`,
            batchConfig,
            60 * 60 * 1000
          );

          logger.info('Recovered batch config from import task', {
            operation: 'batch-config-recovered',
            batchId,
            entityType: batchConfig.entityType,
          });
        } catch (e) {
          logger.error('Failed to recover batch config', {
            operation: 'batch-config-recover-error',
            batchId,
            error: e.message,
          });
        }
      }

      if (
        cacheService.get(`batch:${batchId}:completed`) ||
        batchPollingService.isPolling(batchId)
      ) {
        logger.info('Skipping polling start; already completed or active', {
          operation: 'batch-polling-skip',
          batchId,
        });
        return;
      }

      const pollInterval = Math.max(batchConfig.pollInterval || 5000, 2000);
      const maxPollAttempts = batchConfig.maxPollAttempts || 120;
      const entityType = batchConfig?.entityType || 'unkoen';

      logger.info('Starting batch status polling', {
        operation: 'batch-polling-init',
        batchId,
        pollInterval,
        maxPollAttempts,
        correlationId,
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

          getWs().emitBatchCompleted(batchId, {
            entityType,
            successCount: r.processedCount,
          });

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
          const ws = getWs();
          const msg = JSON.stringify({
            type: 'batch_failed',
            batchId,
            entityType,
            error: err.message,
            timestamp: new Date().toISOString(),
          });
          ws?.wss?.clients?.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) client.send(msg);
          });
        },
      });
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

      res.status(404).json({
        success: false,
        error: 'Batch not found or expired',
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'get-batch-status',
        batchId: req.params.batchId,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get batch status',
      });
    }
  });
};
