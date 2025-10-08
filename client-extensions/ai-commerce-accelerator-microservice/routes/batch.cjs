const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const { get: getWs } = require('../services/wsBus.cjs');
const {
  sanitizedObject,
  parseBatchStatuses,
} = require('../utils/normalize.cjs');

module.exports = function (app, cacheService, batchPollingService, logger) {
  app.post('/api/batch/callback', async (req, res) => {
    const [{ batchId, status, correlationId }] = parseBatchStatuses(req.body);

    try {
      logger.info('Received batch submission callback from Liferay', {
        correlationId: correlationId,
        operation: 'batch-callback',
        batchId: batchId,
        status: status,
        bodyKeys: req.body ? Object.keys(req.body) : [],
      });

      if (DEBUG) {
        logger.debug('=== BATCH SUBMISSION CALLBACK ===');
        logger.debug('Batch ID:', batchId || 'Not provided');
        logger.debug('Status:', status || 'Not provided');
        const sanitizedCallback = sanitizedObject({ ...req.body });
        logger.debug(
          'Full callback data:',
          JSON.stringify(sanitizedCallback, null, 2)
        );
        logger.debug('=== END CALLBACK ===');
      }

      if (batchId) {
        cacheService.set(
          `batch:${batchId}:submission`,
          {
            status: status,
            submittedAt: new Date().toISOString(),
            rawCallback: req.body,
          },
          3600000
        );

        const batchConfig = cacheService.get(`batch:${batchId}:config`);
        if (batchConfig) {
          const pollInterval = Math.max(batchConfig.pollInterval || 5000, 2000); // Minimum 2 seconds
          const maxPollAttempts = batchConfig.maxPollAttempts || 120;

          logger.info('Starting batch status polling', {
            operation: 'batch-polling-init',
            batchId,
            pollInterval,
            maxPollAttempts,
            correlationId,
          });

          const entityType = batchConfig.entityType || 'products';

          batchPollingService.startPolling(batchId, batchConfig, {
            pollInterval,
            maxPollAttempts,
            onStatusChange: (statusUpdate) => {
              logger.debug('Batch status update', {
                operation: 'batch-status-update',
                batchId,
                status: statusUpdate.status,
                processedCount: statusUpdate.processedCount,
                totalCount: statusUpdate.totalCount,
                entityType: entityType,
              });
            },
            onComplete: (results) => {
              logger.success('Batch processing completed', {
                operation: 'batch-complete',
                batchId,
                processedCount: results.processedCount,
                totalCount: results.totalCount,
                entityType: entityType,
              });

              broadcastBatchUpdate(batchId, {
                status: 'completed',
                entityType: entityType,
                data: results,
              });

              logger.info(
                `✅ Batch ${batchId} (${entityType}) completed - ${results.processedCount}/${results.totalCount} items processed`
              );
            },
            onError: (error) => {
              logger.error('Batch processing error', {
                operation: 'batch-error',
                batchId,
                error: error.message,
                entityType: entityType,
              });

              const errorMessage = JSON.stringify({
                type: 'batch_failed',
                batchId,
                entityType: entityType,
                error: error.message,
                timestamp: new Date().toISOString(),
              });

              const ws = getWs();
              ws.wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(errorMessage);
                }
              });

              logger.warn(
                `❌ Batch ${batchId} (${entityType}) error: ${error.message}`
              );
            },
          });
        } else {
          logger.warn('No config found for batch, cannot start polling', {
            operation: 'batch-callback-no-config',
            batchId,
            correlationId,
          });
        }
      }

      res.status(200).json({
        success: true,
        message: 'Batch callback received successfully',
        correlationId: correlationId,
        pollingStarted:
          !!batchId && !!cacheService.get(`batch:${batchId}:config`),
      });
    } catch (error) {
      logger.error('Error processing batch callback', {
        correlationId: correlationId,
        operation: 'batch-callback',
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to process batch callback',
        correlationId: correlationId,
      });
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
