const { logger } = require('../utils/logger.cjs');
const { cacheService } = require('./cacheService.cjs');
const { OAuthService } = require('./oauthService.cjs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class BatchPollingService {
  constructor(wss = null) {
    this.oauthService = new OAuthService();
    this.pollingIntervals = new Map();
    this.activePolls = new Map();
    this.wss = wss; // WebSocket server for broadcasting updates
    this.generationSessions = new Map(); // Track batches by generation session

    if (wss) {
      console.log('✅ BatchPollingService initialized with WebSocket server');
    } else {
      console.log('⚠️ BatchPollingService initialized without WebSocket server');
    }
  }

  setWebSocketServer(wss) {
    this.wss = wss;
  }

  // Track batches for a generation session
  registerGenerationSession(sessionId, batchIds, totalExpectedBatches) {
    this.generationSessions.set(sessionId, {
      batchIds: new Set(batchIds),
      completedBatches: new Set(),
      totalExpected: totalExpectedBatches,
      startTime: new Date(),
      sessionId
    });

    logger.info('Registered generation session', {
      operation: 'generation-session-register',
      sessionId,
      batchIds: Array.from(batchIds),
      totalExpected: totalExpectedBatches
    });
  }

  // Check if all batches in a session are complete
  checkSessionCompletion(sessionId) {
    const session = this.generationSessions.get(sessionId);
    if (!session) {
      return false;
    }

    const allBatchesCompleted = session.batchIds.size === session.completedBatches.size;

    if (allBatchesCompleted) {
      logger.info('Generation session completed - all batches finished', {
        operation: 'generation-session-complete',
        sessionId,
        totalBatches: session.batchIds.size,
        completedBatches: session.completedBatches.size
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
        completedBatches: Array.from(session.completedBatches)
      });

      // Broadcast session completion event
      const message = {
        type: 'generation_session_complete',
        sessionId,
        completedBatches: Array.from(session.completedBatches),
        timestamp: new Date().toISOString()
      };

      // Use global broadcast function if available
      if (typeof global.broadcastSessionComplete === 'function') {
        global.broadcastSessionComplete(sessionId, message);
      } else if (this.wss) {
        this.wss.clients.forEach((ws) => {
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify(message));
            } catch (error) {
              logger.error('Failed to broadcast session completion', {
                operation: 'websocket-session-broadcast-error',
                error: error.message,
                sessionId
              });
            }
          }
        });
      }

      console.log(`🎉 Generation session ${sessionId} completed - ready for post-processing!`);

      // Retrieve session context and trigger post-processing
      const { cacheService } = require('./cacheService.cjs');
      const sessionContext = cacheService.get(`session:${sessionId}:context`);

      if (sessionContext) {
        const { config, productDataList, preparedProducts, options } = sessionContext;

        // Check if post-processing is needed (images, PDFs, or attachments)
        // In demo mode, check ratios instead of generate flags
        const demoMode = sessionContext.options?.demoMode;
        const hasImages = demoMode ? sessionContext.options?.imageRatio > 0 : (sessionContext.options?.generateImages && sessionContext.options?.imageRatio > 0);
        const hasPDFs = demoMode ? sessionContext.options?.pdfRatio > 0 : (sessionContext.options?.generatePDFs && sessionContext.options?.pdfRatio > 0);
        const hasAttachments = sessionContext.productDataList?.some(p => p.defaultImage || p.defaultAttachment);

        if (hasImages || hasPDFs || hasAttachments) {
          logger.info('Starting post-processing for session', {
            operation: 'post-processing-start',
            sessionId,
            hasImages: demoMode ? options.imageRatio > 0 : (options.generateImages && options.imageRatio > 0),
            hasPDFs: demoMode ? options.pdfRatio > 0 : (options.generatePDFs && options.pdfRatio > 0),
            hasAttachments: productDataList.some(p => p.defaultImage || p.defaultAttachment)
          });

          // Import and call post-processing
          const ProductGeneratorClass = require('./productGenerator.cjs');
          const productGenerator = new ProductGeneratorClass(this.wss);
          await productGenerator.processImageAndPDFAttachments(config, productDataList, preparedProducts, options);

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
            hasAttachments
          });
        }
      } else {
        logger.warn('Session context not found for post-processing', {
          operation: 'post-processing-no-context',
          sessionId
        });
      }

    } catch (error) {
      logger.error('Error triggering post-processing', {
        operation: 'post-processing-trigger-error',
        sessionId,
        error: error.message
      });
    }
  }

  async startPolling(batchId, config, options = {}) {
    // Skip polling for mock batch IDs used for WebSocket progress tracking
    const mockBatchIds = ['images-processing', 'pdfs-processing', 'images-progress', 'pdfs-progress', 'images-complete', 'pdfs-complete'];
    if (mockBatchIds.includes(batchId)) {
      logger.info('Skipping polling for mock batch ID used for WebSocket progress', {
        operation: 'polling-skip-mock',
        batchId
      });
      return;
    }

    const {
      pollInterval = 5000, // Default 5 seconds
      maxPollAttempts = 120, // Max 10 minutes (120 * 5s)
      onStatusChange,
      onComplete,
      onError,
      entityType // Added entityType for context
    } = options;

    if (this.activePolls.has(batchId)) {
      logger.warn('Polling already active for batch', {
        operation: 'batch-polling-start',
        batchId,
        message: 'Polling already in progress'
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
      entityType, // Store entityType
      startTime: new Date()
    };

    this.activePolls.set(batchId, pollData);

    logger.info('Starting batch polling', {
      operation: 'batch-polling-start',
      batchId,
      pollInterval,
      maxAttempts: maxPollAttempts,
      entityType // Log entityType
    });

    await this.pollBatchStatus(batchId);
  }

  async pollBatchStatus(batchId) {
    const pollData = this.activePolls.get(batchId);
    if (!pollData) {
      return;
    }

    try {
      pollData.attempts++;

      // Create axios instance with OAuth token
      const accessToken = await this.oauthService.getAccessToken(
        pollData.config.liferayUrl,
        pollData.config.clientId,
        pollData.config.clientSecret,
        pollData.config.localeCode
      );

      const client = axios.create({
        baseURL: pollData.config.liferayUrl,
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
      const totalCount = status.itemsTotal || status.totalItemsCount || status.taskItemTotalCount || status.totalCount || 0;
      const processedCount = status.itemsProcessed || status.processedItemsCount || status.taskItemCompletedCount || status.processedCount || 0;
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
          failedItemsLength: status.failedItems?.length
        }
      });

      // Update cache with current status
      cacheService.set(`batch:${batchId}:status`, {
        status: batchStatus,
        totalCount,
        processedCount,
        errorCount,
        lastChecked: new Date().toISOString(),
        attempt: pollData.attempts
      }, 300000);

      // Call status change callback
      if (pollData.onStatusChange) {
        pollData.onStatusChange({
          batchId,
          status: batchStatus,
          totalCount,
          processedCount,
          errorCount,
          attempt: pollData.attempts
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
      if (pollData.attempts >= pollData.maxAttempts) {
        logger.error('Batch polling exceeded max attempts', {
          operation: 'batch-polling-timeout',
          batchId,
          attempts: pollData.attempts,
          maxAttempts: pollData.maxAttempts
        });

        if (pollData.onError) {
          pollData.onError(new Error(`Batch polling timed out after ${pollData.maxAttempts} attempts`));
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
        attempt: pollData.attempts
      });

      if (pollData.onError) {
        pollData.onError(error);
      }

      // Continue polling unless it's a critical error
      // Stop polling on 401, 404, 406 (Not Acceptable) which indicates the batch endpoint is no longer valid
      const shouldStopPolling = error.message.includes('401') ||
                               error.message.includes('404') ||
                               error.message.includes('406') ||
                               pollData.attempts >= pollData.maxAttempts;

      if (shouldStopPolling) {
        logger.warn('Stopping polling due to error condition', {
          operation: 'batch-polling-stop-error',
          batchId,
          error: error.message,
          attempts: pollData.attempts,
          httpStatus: error.response?.status
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
    // Check if we've already processed this batch completion to prevent duplicates
    const alreadyProcessed = cacheService.get(`batch:${batchId}:completed`);
    if (alreadyProcessed) {
      logger.warn('Batch completion already processed, skipping duplicate', {
        operation: 'batch-complete-duplicate',
        batchId
      });
      return;
    }

    // Mark as completed immediately to prevent race conditions
    cacheService.set(`batch:${batchId}:completed`, true, 300000); // 5 minutes

    // Map Liferay field names to our expected field names
    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount = status.processedItemsCount || status.processedCount || 0;
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
        failedItemsLength: status.failedItems?.length
      }
    });

    // Stop polling immediately to prevent additional requests
    this.stopPolling(batchId);

    const results = {
      batchId,
      status: 'COMPLETED',
      totalCount,
      processedCount,
      errorCount,
      completedAt: new Date().toISOString()
    };

    // Get entity type from polling data or batch configuration
    const pollData = this.activePolls.get(batchId);
    let entityType = pollData?.entityType;

    if (!entityType) {
      const batchConfig = cacheService.get(`batch:${batchId}:config`);
      entityType = batchConfig?.entityType || 'products'; // Default to products instead of unknown
    }

    logger.info('Handling batch completion', {
      operation: 'batch-complete-handler',
      batchId,
      status: 'COMPLETED',
      processedCount: results.processedCount,
      totalCount: results.totalCount,
      entityType
    });

    // Use global broadcastBatchUpdate function if available, otherwise check WebSocket server
    // Skip broadcasting for image/PDF processing as ProductGenerator handles these directly
    if (typeof global.broadcastBatchUpdate === 'function' && !batchId.toString().includes('images') && !batchId.toString().includes('pdfs')) {
      logger.info('Using global broadcastBatchUpdate function', {
        operation: 'batch-complete-broadcast',
        batchId,
        entityType
      });

      global.broadcastBatchUpdate(batchId, {
        status: 'completed',
        entityType: entityType,
        ...results
      });
    } else if (!this.wss) {
      logger.error('No WebSocket server available', {
        operation: 'websocket-broadcast-no-server',
        batchId
      });
      console.log('❌ No WebSocket server available for broadcasting');
    } else if (this.wss.clients.size === 0) {
      logger.warn('No WebSocket clients connected', {
        operation: 'websocket-broadcast-no-clients',
        batchId
      });
      console.log('⚠️ No WebSocket clients connected for broadcasting');
    } else {
      const message = {
        type: 'batch_completed',
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
          completedAt: results.completedAt
        },
        timestamp: new Date().toISOString()
      };

      console.log('🔥 Broadcasting batch completion message:', JSON.stringify(message, null, 2));
      console.log(`📡 WebSocket clients available: ${this.wss.clients.size}`);

      let broadcastCount = 0;
      let failedCount = 0;
      let clientsInfo = [];

      this.wss.clients.forEach((ws) => {
        const clientInfo = {
          correlationId: ws.correlationId || 'unknown',
          readyState: ws.readyState,
          isOpen: ws.readyState === 1,
          url: ws.url || 'unknown'
        };
        clientsInfo.push(clientInfo);

        if (ws.readyState === 1) { // WebSocket.OPEN
          try {
            ws.send(JSON.stringify(message));
            broadcastCount++;
            console.log(`✅ Message sent to client ${ws.correlationId || 'unknown'}`);
          } catch (error) {
            failedCount++;
            console.error(`❌ Failed to send to client ${ws.correlationId || 'unknown'}:`, error.message);
            logger.error('Failed to send WebSocket message', {
              operation: 'websocket-send-error',
              error: error.message,
              batchId,
              clientCorrelationId: ws.correlationId
            });
          }
        } else {
          console.log(`⚠️ Skipping client ${ws.correlationId || 'unknown'} - readyState: ${ws.readyState} (expected: 1 for OPEN)`);
        }
      });

      console.log('📊 WebSocket broadcast summary:', {
        totalClients: this.wss.clients.size,
        broadcastSuccessful: broadcastCount,
        broadcastFailed: failedCount,
        clientsInfo
      });

      logger.info('Broadcasted batch completion via WebSocket', {
        operation: 'websocket-broadcast',
        batchId,
        entityType,
        successCount: results.processedCount,
        clientCount: this.wss.clients.size,
        broadcastSuccessful: broadcastCount,
        broadcastFailed: failedCount
      });

      // If no messages were sent successfully, log as warning
      if (broadcastCount === 0) {
        console.warn('⚠️ No WebSocket clients received the batch completion message!');
        logger.warn('No WebSocket clients received message', {
          operation: 'websocket-broadcast-no-recipients',
          batchId,
          totalClients: this.wss.clients.size,
          reason: failedCount > 0 ? 'send_failures' : 'no_open_connections'
        });
      }
    }

    // Store final results in cache
    cacheService.set(`batch:${batchId}:final`, results, 1800000); // 30 minutes

    const pollDataForCompletion = this.activePolls.get(batchId);
    if (pollDataForCompletion && pollDataForCompletion.onComplete) {
      pollDataForCompletion.onComplete(results);
    }

    // Check if this batch completion triggers session completion
    this.markBatchCompleteInSessions(batchId);
  }

  async handleBatchFailed(batchId, status, client) {
    // Check if we've already processed this batch failure to prevent duplicates
    const alreadyProcessed = cacheService.get(`batch:${batchId}:failed`);
    if (alreadyProcessed) {
      logger.warn('Batch failure already processed, skipping duplicate', {
        operation: 'batch-failed-duplicate',
        batchId
      });
      return;
    }

    // Mark as failed immediately to prevent race conditions
    cacheService.set(`batch:${batchId}:failed`, true, 300000); // 5 minutes

    // Map Liferay field names to our expected field names
    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount = status.processedItemsCount || status.processedCount || 0;
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
        failedItemsLength: status.failedItems?.length
      }
    });

    // Stop polling immediately to prevent additional requests
    this.stopPolling(batchId);

    const results = {
      batchId,
      status: 'FAILED',
      totalCount,
      processedCount,
      errorCount,
      failedAt: new Date().toISOString()
    };

    // Get entity type from polling data or batch configuration
    const pollData = this.activePolls.get(batchId);
    let entityType = pollData?.entityType;

    if (!entityType) {
      const batchConfig = cacheService.get(`batch:${batchId}:config`);
      entityType = batchConfig?.entityType || 'products'; // Default to products instead of unknown
    }

    logger.info('Handling batch failure', {
      operation: 'batch-failed-handler',
      batchId,
      status: 'FAILED',
      processedCount: results.processedCount,
      totalCount: results.totalCount,
      errorCount: results.errorCount,
      entityType
    });

    // Use global broadcastBatchUpdate function if available, otherwise check WebSocket server
    if (typeof global.broadcastBatchUpdate === 'function') {
      logger.info('Using global broadcastBatchUpdate function for failure', {
        operation: 'batch-failed-broadcast',
        batchId,
        entityType
      });

      global.broadcastBatchUpdate(batchId, {
        type: 'batch_failed',
        entityType,
        error: `Batch failed with ${results.errorCount} errors`,
        data: results
      });
    } else if (!this.wss) {
      logger.error('No WebSocket server available for failure broadcast', {
        operation: 'websocket-broadcast-no-server',
        batchId
      });
      console.log('❌ No WebSocket server available for broadcasting failure');
    } else if (this.wss.clients.size === 0) {
      logger.warn('No WebSocket clients connected for failure broadcast', {
        operation: 'websocket-broadcast-no-clients',
        batchId
      });
      console.log('⚠️ No WebSocket clients connected for broadcasting failure');
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
          failedAt: results.failedAt
        },
        timestamp: new Date().toISOString()
      };

      let broadcastCount = 0;
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          try {
            ws.send(JSON.stringify(message));
            broadcastCount++;
          } catch (error) {
            logger.error('Failed to send WebSocket message', {
              operation: 'websocket-send-error',
              error: error.message,
              batchId
            });
          }
        }
      });

      logger.info('Broadcasted batch failure via WebSocket', {
        operation: 'websocket-broadcast',
        batchId,
        entityType,
        errorCount: results.errorCount,
        clientCount: this.wss.clients.size,
        broadcastSuccessful: broadcastCount
      });
    }

    // Store final results in cache
    cacheService.set(`batch:${batchId}:final`, results, 1800000); // 30 minutes

    const pollDataForFailure = this.activePolls.get(batchId);
    if (pollDataForFailure && pollDataForFailure.onError) {
      pollDataForFailure.onError(new Error(`Batch failed with ${status.errorCount || 0} errors`));
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
      batchId
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
      isActive: true
    };
  }

  // Mark a batch as completed in all relevant sessions
  markBatchCompleteInSessions(batchId) {
    for (const [sessionId, session] of this.generationSessions.entries()) {
      if (session.batchIds.has(batchId)) {
        session.completedBatches.add(batchId);

        logger.debug('Marked batch complete in session', {
          operation: 'batch-complete-session-mark',
          batchId,
          sessionId,
          completedBatches: session.completedBatches.size,
          totalBatches: session.batchIds.size
        });

        // Check if this session is now complete
        this.checkSessionCompletion(sessionId);
      }
    }
  }

  stopAllPolling() {
    for (const batchId of this.activePolls.keys()) {
      this.stopPolling(batchId);
    }
    logger.info('Stopped all batch polling', {
      operation: 'batch-polling-stop-all'
    });
  }
}

module.exports = { BatchPollingService };