const axios = require('axios');
const WebSocket = require('ws');

const { logger } = require('../utils/logger.cjs');
const { cacheService } = require('./cacheService.cjs');
const { OAuthService } = require('./oauthService.cjs');
const { get: getWs } = require('../services/wsBus.cjs');

function extractIdFromLocation(location) {
  if (!location || typeof location !== 'string') return null;
  const m = location.match(/\/import-task\/(\d+)/);
  return m ? m[1] : null;
}

class BatchPollingService {
  constructor() {
    this.oauthService = new OAuthService();
    this.pollingIntervals = new Map();
    this.activePolls = new Map();
    this.generationSessions = new Map(); // Track batches by generation session
    this.ws = getWs();
  }

  // Track batches for a generation session
  registerGenerationSession(sessionId, batchIds, totalExpectedBatches) {
    this.generationSessions.set(sessionId, {
      batchIds: new Set(batchIds),
      completedBatches: new Set(),
      totalExpected: totalExpectedBatches,
      startTime: new Date(),
      sessionId,
    });

    logger.info('Registered generation session', {
      operation: 'generation-session-register',
      sessionId,
      batchIds: Array.from(batchIds),
      totalExpected: totalExpectedBatches,
    });
  }

  // Check if all batches in a session are complete
  checkSessionCompletion(sessionId) {
    const session = this.generationSessions.get(sessionId);
    if (!session) {
      return false;
    }

    const allBatchesCompleted =
      session.batchIds.size === session.completedBatches.size;

    if (allBatchesCompleted) {
      logger.info('Generation session completed - all batches finished', {
        operation: 'generation-session-complete',
        sessionId,
        totalBatches: session.batchIds.size,
        completedBatches: session.completedBatches.size,
      });

      // Trigger post-processing for images and PDFs
      this.triggerPostProcessing(sessionId, session);

      // Clean up session tracking
      this.generationSessions.delete(sessionId);

      return true;
    }

    return false;
  }

  // Trigger post-processing when all batches are complete
  async triggerPostProcessing(sessionId, session) {
    try {
      logger.info('Triggering post-processing for session', {
        operation: 'post-processing-trigger',
        sessionId,
        completedBatches: Array.from(session.completedBatches),
      });

      // Broadcast session completion event
      const message = {
        type: 'generation_session_complete',
        sessionId,
        completedBatches: Array.from(session.completedBatches),
        timestamp: new Date().toISOString(),
      };

      if (this.ws.wss) {
        this.ws.wss.clients.forEach((ws) => {
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify(message));
            } catch (error) {
              logger.error('Failed to broadcast session completion', {
                operation: 'websocket-session-broadcast-error',
                error: error.message,
                sessionId,
              });
            }
          }
        });
      }

      logger.info(
        `🎉 Generation session ${sessionId} completed - ready for post-processing!`
      );

      // Retrieve session context and trigger post-processing
      const { cacheService } = require('./cacheService.cjs');
      const sessionContext = cacheService.get(`session:${sessionId}:context`);

      if (sessionContext) {
        const { config, productDataList, preparedProducts, options } =
          sessionContext;

        // Check if post-processing is needed (images, PDFs, or attachments)
        // In demo mode, check ratios instead of generate flags
        const demoMode = sessionContext.options?.demoMode;
        const hasImages = demoMode
          ? sessionContext.options?.imageRatio > 0
          : sessionContext.options?.generateImages &&
            sessionContext.options?.imageRatio > 0;
        const hasPDFs = demoMode
          ? sessionContext.options?.pdfRatio > 0
          : sessionContext.options?.generatePDFs &&
            sessionContext.options?.pdfRatio > 0;
        const hasAttachments = sessionContext.productDataList?.some(
          (p) => p.defaultImage || p.defaultAttachment
        );

        if (hasImages || hasPDFs || hasAttachments) {
          logger.info('Starting post-processing for session', {
            operation: 'post-processing-start',
            sessionId,
            hasImages: demoMode
              ? options.imageRatio > 0
              : options.generateImages && options.imageRatio > 0,
            hasPDFs: demoMode
              ? options.pdfRatio > 0
              : options.generatePDFs && options.pdfRatio > 0,
            hasAttachments: productDataList.some(
              (p) => p.defaultImage || p.defaultAttachment
            ),
          });

          // Import and call post-processing
          const ProductGeneratorClass = require('./productGenerator.cjs');
          const productGenerator = new ProductGeneratorClass(this.ws);
          await productGenerator.processImageAndPDFAttachments(
            config,
            productDataList,
            preparedProducts,
            options
          );

          // Clean up session context
          cacheService.delete(`session:${sessionId}:context`);
        } else {
          logger.info('No post-processing needed for session', {
            operation: 'post-processing-skip',
            sessionId: session.sessionId,
            reason: 'No images, PDFs, or attachments configured',
            demoMode,
            imageRatio: sessionContext.options?.imageRatio || 0,
            pdfRatio: sessionContext.options?.pdfRatio || 0,
            hasAttachments,
          });
        }
      } else {
        logger.warn('Session context not found for post-processing', {
          operation: 'post-processing-no-context',
          sessionId,
        });
      }
    } catch (error) {
      logger.error('Error triggering post-processing', {
        operation: 'post-processing-trigger-error',
        sessionId,
        error: error.message,
      });
    }
  }

  startMonitors(jobs = [], globalOptions = {}) {
    for (const job of jobs) {
      const { entity, refs = [], meta = {} } = job;
      const { mode = 'generate', affectsProgress = true } = meta;

      for (const ref of refs) {
        const batchId = ref.taskId || extractIdFromLocation(ref.location);
        if (!batchId) continue;

        cacheService.set(
          `batch:${batchId}:config`,
          { entityType: entity, mode, affectsProgress },
          300000
        );

        this.startPolling(
          batchId,
          meta.config || {},
          {
            ...globalOptions,
            entityType: entity,
            mode,
            affectsProgress,
          }
        );
      }
    }
  }

  async startPolling(batchId, config, options = {}) {
    const {
      pollInterval = 5000,
      maxPollAttempts = 120,
      onStatusChange,
      onComplete,
      onError,
      entityType,
      // NEW:
      mode = 'generate', // 'generate' | 'delete' | 'other'
      affectsProgress = true,
    } = options;

    if (this.activePolls.has(batchId)) {
      logger.warn('Polling already active for batch', {
        operation: 'batch-polling-start',
        batchId,
      });
      return;
    }

    const pollData = {
      batchId,
      config,
      attempts: 0,
      maxAttempts: maxPollAttempts,
      pollInterval,
      onStatusChange,
      onComplete,
      onError,
      entityType,
      mode,
      affectsProgress,
      startTime: new Date(),
    };

    this.activePolls.set(batchId, pollData);

    logger.info('Starting batch polling', {
      operation: 'batch-polling-start',
      batchId,
      pollInterval,
      maxAttempts: maxPollAttempts,
      entityType,
      mode,
      affectsProgress,
    });

    await this.pollBatchStatus(batchId);
  }

  async pollBatchStatus(batchId) {
    const pollData = this.activePolls.get(batchId);
    if (!pollData) {
      logger.info(`Unable to find poll data - ${batchId}`);
      return;
    }
    const config = pollData.config;

    if (!config) {
      logger.info(`Unable to find config in the poll data - ${batchId}`);
      return;
    }

    try {
      pollData.attempts++;

      // Create axios instance with OAuth token
      const accessToken =
        config.clientId === null
          ? await this.oauthService.getAccessTokenFromRoute()
          : await this.oauthService.getAccessToken(
              config.liferayUrl,
              config.clientId,
              config.clientSecret
            );

      const client = axios.create({
        baseURL: config.liferayUrl,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
      });

      // Get batch status
      const statusResponse = await client.get(
        `/o/headless-batch-engine/v1.0/import-task/${batchId}`
      );

      const status = statusResponse.data;
      const batchStatus = status.executeStatus || status.status || 'UNKNOWN';

      // Map Liferay field names to our expected field names
      const totalCount =
        status.itemsTotal ||
        status.totalItemsCount ||
        status.taskItemTotalCount ||
        status.totalCount ||
        0;
      const processedCount =
        status.itemsProcessed ||
        status.processedItemsCount ||
        status.taskItemCompletedCount ||
        status.processedCount ||
        0;
      const errorCount = status.failedItems?.length || status.errorCount || 0;

      logger.debug('Batch status polled', {
        operation: 'batch-polling-check',
        batchId,
        status: batchStatus,
        attempt: pollData.attempts,
        totalCount,
        processedCount,
        errorCount,
        rawStatus: {
          totalItemsCount: status.totalItemsCount,
          processedItemsCount: status.processedItemsCount,
          failedItemsLength: status.failedItems?.length,
        },
      });

      // Update cache with current status
      cacheService.set(
        `batch:${batchId}:status`,
        {
          status: batchStatus,
          totalCount,
          processedCount,
          errorCount,
          lastChecked: new Date().toISOString(),
          attempt: pollData.attempts,
        },
        300000
      );

      // Call status change callback
      if (pollData.onStatusChange) {
        pollData.onStatusChange({
          batchId,
          status: batchStatus,
          totalCount,
          processedCount,
          errorCount,
          attempt: pollData.attempts,
        });
      }

      // Check if batch is complete - stop polling immediately
      if (batchStatus === 'COMPLETED') {
        this.stopPolling(batchId); // Stop polling FIRST to prevent duplicate calls
        await this.handleBatchComplete(batchId, status, client);
        return; // Stop polling completely
      } else if (batchStatus === 'FAILED') {
        this.stopPolling(batchId); // Stop polling FIRST to prevent duplicate calls
        await this.handleBatchFailed(batchId, status, client);
        return; // Stop polling completely
      }

      // Check if we've exceeded max attempts
      if (pollData.attempts > pollData.maxAttempts) {
        logger.error('Batch polling exceeded max attempts', {
          operation: 'batch-polling-timeout',
          batchId,
          attempts: pollData.attempts,
          maxAttempts: pollData.maxAttempts,
        });

        if (pollData.onError) {
          pollData.onError(
            new Error(
              `Batch polling timed out after ${pollData.maxAttempts} attempts`
            )
          );
        }

        this.stopPolling(batchId);
        return;
      }

      // Schedule next poll
      const timeoutId = setTimeout(() => {
        this.pollBatchStatus(batchId);
      }, pollData.pollInterval);

      this.pollingIntervals.set(batchId, timeoutId);
    } catch (error) {
      logger.error('Error polling batch status', {
        operation: 'batch-polling-error',
        batchId,
        error: error.message,
        attempt: pollData.attempts,
      });

      if (pollData.onError) {
        pollData.onError(error);
      }

      // Continue polling unless it's a critical error
      // Stop polling on 401, 404, 406 (Not Acceptable) which indicates the batch endpoint is no longer valid
      const shouldStopPolling =
        error.message.includes('401') ||
        error.message.includes('404') ||
        error.message.includes('406') ||
        pollData.attempts >= pollData.maxAttempts;

      if (shouldStopPolling) {
        logger.warn('Stopping polling due to error condition', {
          operation: 'batch-polling-stop-error',
          batchId,
          error: error.message,
          attempts: pollData.attempts,
          httpStatus: error.response?.status,
        });
        this.stopPolling(batchId);
      } else {
        const timeoutId = setTimeout(() => {
          this.pollBatchStatus(batchId);
        }, pollData.pollInterval);

        this.pollingIntervals.set(batchId, timeoutId);
      }
    }
  }

  async handleBatchComplete(batchId, status, client) {
    const alreadyProcessed = cacheService.get(`batch:${batchId}:completed`);
    if (alreadyProcessed) {
      logger.warn('Batch completion already processed, skipping duplicate', {
        operation: 'batch-complete-duplicate',
        batchId,
      });
      return;
    }

    // Mark as completed immediately to prevent race conditions
    cacheService.set(`batch:${batchId}:completed`, true, 300000); // 5 minutes

    // Map Liferay field names to our expected field names
    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount =
      status.processedItemsCount || status.processedCount || 0;
    const errorCount = status.failedItems?.length || status.errorCount || 0;

    logger.info('Batch completed successfully', {
      operation: 'batch-complete',
      batchId,
      totalCount,
      processedCount,
      errorCount,
      rawStatus: {
        totalItemsCount: totalCount,
        processedItemsCount: processedCount,
        failedItemsLength: status.failedItems?.length,
      },
    });

    // Stop polling immediately to prevent additional requests
    this.stopPolling(batchId);

    const results = {
      batchId,
      status: 'COMPLETED',
      totalCount,
      processedCount,
      errorCount,
      completedAt: new Date().toISOString(),
    };

    // Get entity type from polling data or batch configuration
    const pollData = this.activePolls.get(batchId);
    const affectsProgress = pollData?.affectsProgress ?? true;
    const entityType =
      pollData?.entityType ||
      cacheService.get(`batch:${batchId}:config`)?.entityType ||
      'products';
    const mode = pollData?.mode || 'generate';

    logger.info('Handling batch completion', {
      operation: 'batch-complete-handler',
      batchId,
      status: 'COMPLETED',
      processedCount: results.processedCount,
      totalCount: results.totalCount,
      entityType,
    });

    if (!this.ws) {
      logger.error('No WebSocket server available', {
        operation: 'websocket-broadcast-no-server',
        batchId,
      });
      logger.info('❌ No WebSocket server available for broadcasting');
    } else if (this.ws.wss.clients.size === 0) {
      logger.warn('No WebSocket clients connected', {
        operation: 'websocket-broadcast-no-clients',
        batchId,
      });
      logger.info('⚠️ No WebSocket clients connected for broadcasting');
    } else {
      const message = {
        type: 'batch_completed',
        mode,
        activityOnly: !affectsProgress,
        batchId,
        entityType,
        successCount: results.processedCount,
        failureCount: results.errorCount,
        details: {
          batchId: results.batchId,
          status: results.status,
          totalCount: results.totalCount,
          processedCount: results.processedCount,
          errorCount: results.errorCount,
          completedAt: results.completedAt,
        },
        timestamp: new Date().toISOString(),
      };

      logger.info(
        '🔥 Broadcasting batch completion message:',
        JSON.stringify(message, null, 2)
      );
      logger.debug(
        `📡 WebSocket clients available: ${this.ws.wss.clients.size}`
      );

      let broadcastCount = 0;
      let failedCount = 0;
      let clientsInfo = [];

      this.ws.wss.clients.forEach((ws) => {
        const clientInfo = {
          correlationId: ws.correlationId || 'unknown',
          readyState: ws.readyState,
          isOpen: ws.readyState === 1,
          url: ws.url || 'unknown',
        };
        clientsInfo.push(clientInfo);

        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(message));
            broadcastCount++;
            logger.debug(
              `✅ Message sent to client ${ws.correlationId || 'unknown'}`
            );
          } catch (error) {
            failedCount++;
            logger.error(
              `❌ Failed to send to client ${ws.correlationId || 'unknown'}:`,
              error.message
            );
            logger.error('Failed to send WebSocket message', {
              operation: 'websocket-send-error',
              error: error.message,
              batchId,
              clientCorrelationId: ws.correlationId,
            });
          }
        } else {
          logger.info(
            `⚠️ Skipping client ${
              ws.correlationId || 'unknown'
            } - readyState: ${ws.readyState} (expected: 1 for OPEN)`
          );
        }
      });

      logger.debug('📊 WebSocket broadcast summary:', {
        totalClients: this.ws.wss.clients.size,
        broadcastSuccessful: broadcastCount,
        broadcastFailed: failedCount,
        clientsInfo,
      });

      logger.info('Broadcasted batch completion via WebSocket', {
        operation: 'websocket-broadcast',
        batchId,
        entityType,
        successCount: results.processedCount,
        clientCount: this.ws.wss.clients.size,
        broadcastSuccessful: broadcastCount,
        broadcastFailed: failedCount,
      });

      // If no messages were sent successfully, log as warning
      if (broadcastCount === 0) {
        logger.warn(
          '⚠️ No WebSocket clients received the batch completion message!'
        );
        logger.warn('No WebSocket clients received message', {
          operation: 'websocket-broadcast-no-recipients',
          batchId,
          totalClients: this.ws.wss.clients.size,
          reason: failedCount > 0 ? 'send_failures' : 'no_open_connections',
        });
      }
    }

    // Store final results in cache
    cacheService.set(`batch:${batchId}:final`, results, 1800000); // 30 minutes

    const pollDataForCompletion = this.activePolls.get(batchId);
    if (pollDataForCompletion && pollDataForCompletion.onComplete) {
      pollDataForCompletion.onComplete(results);
    }

    if (affectsProgress && mode === 'generate') {
      this.markBatchCompleteInSessions(batchId);
    }
  }

  async handleBatchFailed(batchId, status, client) {
    // Check if we've already processed this batch failure to prevent duplicates
    const alreadyProcessed = cacheService.get(`batch:${batchId}:failed`);
    if (alreadyProcessed) {
      logger.warn('Batch failure already processed, skipping duplicate', {
        operation: 'batch-failed-duplicate',
        batchId,
      });
      return;
    }

    // Mark as failed immediately to prevent race conditions
    cacheService.set(`batch:${batchId}:failed`, true, 300000); // 5 minutes

    // Map Liferay field names to our expected field names
    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount =
      status.processedItemsCount || status.processedCount || 0;
    const errorCount = status.failedItems?.length || status.errorCount || 0;

    logger.error('Batch failed', {
      operation: 'batch-failed',
      batchId,
      totalCount,
      processedCount,
      errorCount,
      rawStatus: {
        totalItemsCount: totalCount,
        processedItemsCount: processedCount,
        failedItemsLength: status.failedItems?.length,
      },
    });

    // Stop polling immediately to prevent additional requests
    this.stopPolling(batchId);

    const results = {
      batchId,
      status: 'FAILED',
      totalCount,
      processedCount,
      errorCount,
      failedAt: new Date().toISOString(),
    };

    const pollData = this.activePolls.get(batchId);
    const affectsProgress = pollData?.affectsProgress ?? true;
    const entityType =
      pollData?.entityType ||
      cacheService.get(`batch:${batchId}:config`)?.entityType ||
      'products';
    const mode = pollData?.mode || 'generate';

    logger.info('Handling batch failure', {
      operation: 'batch-failed-handler',
      batchId,
      status: 'FAILED',
      processedCount: results.processedCount,
      totalCount: results.totalCount,
      errorCount: results.errorCount,
      entityType,
    });

    if (!this.ws) {
      logger.error('No WebSocket server available for failure broadcast', {
        operation: 'websocket-broadcast-no-server',
        batchId,
      });
      logger.info('❌ No WebSocket server available for broadcasting failure');
    } else if (this.ws.wss.clients.size === 0) {
      logger.warn('No WebSocket clients connected for failure broadcast', {
        operation: 'websocket-broadcast-no-clients',
        batchId,
      });
      logger.info('⚠️ No WebSocket clients connected for broadcasting failure');
    } else {
      const message = {
        type: 'batch_failed',
        batchId,
        entityType,
        error: `Batch failed with ${results.errorCount} errors`,
        successCount: results.processedCount,
        failureCount: results.errorCount,
        details: {
          totalCount: results.totalCount,
          processedCount: results.processedCount,
          errorCount: results.errorCount,
          failedAt: results.failedAt,
        },
        timestamp: new Date().toISOString(),
      };

      let broadcastCount = 0;
      this.ws.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(message));
            broadcastCount++;
          } catch (error) {
            logger.error('Failed to send WebSocket message', {
              operation: 'websocket-send-error',
              error: error.message,
              batchId,
            });
          }
        }
      });

      logger.info('Broadcasted batch failure via WebSocket', {
        operation: 'websocket-broadcast',
        mode,
        activityOnly: !affectsProgress,
        batchId,
        entityType,
        errorCount: results.errorCount,
        clientCount: this.ws.wss.clients.size,
        broadcastSuccessful: broadcastCount,
      });
    }

    // Store final results in cache
    cacheService.set(`batch:${batchId}:final`, results, 1800000); // 30 minutes

    const pollDataForFailure = this.activePolls.get(batchId);
    if (pollDataForFailure && pollDataForFailure.onError) {
      pollDataForFailure.onError(
        new Error(`Batch failed with ${status.errorCount || 0} errors`)
      );
    }
  }

  stopPolling(batchId) {
    const timeoutId = this.pollingIntervals.get(batchId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pollingIntervals.delete(batchId);
    }

    this.activePolls.delete(batchId);

    logger.info('Stopped polling for batch', {
      operation: 'batch-polling-stop',
      batchId,
    });
  }

  isPolling(batchId) {
    return this.activePolls.has(batchId);
  }

  getPollingStatus(batchId) {
    const pollData = this.activePolls.get(batchId);
    if (!pollData) {
      return null;
    }

    return {
      batchId,
      attempts: pollData.attempts,
      maxAttempts: pollData.maxAttempts,
      startTime: pollData.startTime,
      isActive: true,
    };
  }

  markBatchCompleteInSessions(batchId) {
    for (const [sessionId, session] of this.generationSessions.entries()) {
      if (session.batchIds.has(batchId)) {
        session.completedBatches.add(batchId);
        logger.debug('Marked batch complete in session', {
          operation: 'batch-complete-session-mark',
          batchId,
          sessionId,
          completedBatches: session.completedBatches.size,
          totalBatches: session.batchIds.size,
        });
        this.checkSessionCompletion(sessionId);
      }
    }
  }

  stopAllPolling() {
    for (const batchId of this.activePolls.keys()) {
      this.stopPolling(batchId);
    }
    logger.info('Stopped all batch polling', {
      operation: 'batch-polling-stop-all',
    });
  }
}

module.exports = { BatchPollingService };
