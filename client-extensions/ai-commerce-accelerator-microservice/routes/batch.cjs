const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const { get: getWs } = require('../services/wsBus.cjs');
const {
  sanitizedObject,
  parseBatchStatuses,
} = require('../utils/normalize.cjs');

module.exports = function (app, cacheService, batchPollingService, logger) {
  // Batch callback endpoint for Liferay to call when batch processing is submitted
  app.post('/api/batch/callback', async (req, res) => {
    const [{ batchId, status, correlationId }] = parseBatchStatuses(req.body);

    try {
      // Log batch submission callback
      logger.info('Received batch submission callback from Liferay', {
        correlationId: correlationId,
        operation: 'batch-callback',
        batchId: batchId,
        status: status,
        bodyKeys: req.body ? Object.keys(req.body) : [],
      });

      console.log('=== BATCH SUBMISSION CALLBACK ===');
      console.log('Batch ID:', batchId || 'Not provided');
      console.log('Status:', status || 'Not provided');

      // Log callback data with sensitive fields redacted
      const sanitizedCallback = sanitizedObject({ ...req.body });
      console.log(
        'Full callback data:',
        JSON.stringify(sanitizedCallback, null, 2)
      );
      console.log('=== END CALLBACK ===');

      // Store initial batch submission data
      if (batchId) {
        // Cache the submission callback
        cacheService.set(
          `batch:${batchId}:submission`,
          {
            status: status,
            submittedAt: new Date().toISOString(),
            rawCallback: req.body,
          },
          3600000 // 1 hour cache
        );

        // Try to get the config from cache to start polling
        const batchConfig = cacheService.get(`batch:${batchId}:config`);
        if (batchConfig) {
          // Get poll interval from config with defaults
          const pollInterval = Math.max(batchConfig.pollInterval || 5000, 2000); // Minimum 2 seconds
          const maxPollAttempts = batchConfig.maxPollAttempts || 120;

          logger.info('Starting batch status polling', {
            operation: 'batch-polling-init',
            batchId,
            pollInterval,
            maxPollAttempts,
            correlationId,
          });

          // Determine entity type from batch config or cache
          const entityType = batchConfig.entityType || 'products'; // Default to products

          // Start polling for batch completion
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

              // Don't broadcast status changes, only final completion
            },
            onComplete: (results) => {
              logger.success('Batch processing completed', {
                operation: 'batch-complete',
                batchId,
                processedCount: results.processedCount,
                totalCount: results.totalCount,
                entityType: entityType,
              });

              // Broadcast completion to WebSocket clients with proper message format
              broadcastBatchUpdate(batchId, {
                status: 'completed',
                entityType: entityType,
                data: results,
              });

              console.log(
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

              // Broadcast error to WebSocket clients
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

              console.log(
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

      // Check for final results first
      const finalResults = cacheService.get(`batch:${batchId}:final`);
      if (finalResults) {
        return res.json({
          success: true,
          batchId,
          ...finalResults,
          isFinal: true,
        });
      }

      // Check current polling status
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

      // Check submission data
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
