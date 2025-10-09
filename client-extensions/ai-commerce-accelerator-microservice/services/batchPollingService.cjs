const axios = require('axios');

const { logger } = require('../utils/logger.cjs');
const { cacheService } = require('./cacheService.cjs');
const { OAuthService } = require('./oauthService.cjs');
const { get: getWs } = require('../services/wsBus.cjs');
const {
  delayCall,
  inferEntityTypeFromClassName,
} = require('../utils/misc.cjs');

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
    this.generationSessions = new Map();
  }

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

  async triggerPostProcessing(sessionId, session) {
    try {
      logger.info('Triggering post-processing for session', {
        operation: 'post-processing-trigger',
        sessionId,
        completedBatches: Array.from(session.completedBatches),
      });

      const message = {
        type: 'generation_session_complete',
        sessionId,
        completedBatches: Array.from(session.completedBatches),
        timestamp: new Date().toISOString(),
      };

      getWs().broadcase(message);

      logger.info(
        `🎉 Generation session ${sessionId} completed - ready for post-processing!`
      );

      const { cacheService } = require('./cacheService.cjs');
      const sessionContext = cacheService.get(`session:${sessionId}:context`);

      if (sessionContext) {
        const { config, productDataList, preparedProducts, options } =
          sessionContext;

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

          const ProductGeneratorClass = require('./productGenerator.cjs');
          const productGenerator = new ProductGeneratorClass();
          await productGenerator.processImageAndPDFAttachments(
            config,
            productDataList,
            preparedProducts,
            options
          );

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
      const { mode = 'unknown', affectsProgress = true } = meta;

      for (const ref of refs) {
        const batchId = ref.taskId || extractIdFromLocation(ref.location);
        if (!batchId) continue;

        cacheService.set(
          `batch:${batchId}:config`,
          {
            affectsProgress,
            entityType: entity,
            mode,
          },
          300000
        );

        this.startPolling(batchId, meta.config || {}, {
          ...globalOptions,
          entityType: entity,
          mode,
          affectsProgress,
        });
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
      mode = 'unknown',
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

    logger.debug('Starting batch polling', {
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

      const statusResponse = await client.get(
        `/o/headless-batch-engine/v1.0/import-task/${batchId}`
      );

      const status = statusResponse.data;
      const batchStatus = status.executeStatus || status.status || 'UNKNOWN';
      const entitytype = inferEntityTypeFromClassName(status.className);

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

      logger.trace('Batch status polled', {
        operation: 'batch-polling-check',
        batchId,
        entitytype,
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

      cacheService.set(
        `batch:${batchId}:status`,
        {
          status: batchStatus,
          totalCount,
          processedCount,
          errorCount,
          lastChecked: new Date().toISOString(),
          attempt: pollData.attempts,
          entitytype,
        },
        300000
      );

      if (pollData.onStatusChange) {
        pollData.onStatusChange({
          batchId,
          entitytype,
          status: batchStatus,
          totalCount,
          processedCount,
          errorCount,
          attempt: pollData.attempts,
        });
      }

      if (batchStatus === 'COMPLETED') {
        this.stopPolling(batchId);
        await this.handleBatchComplete(batchId, status, client);
        return;
      } else if (batchStatus === 'FAILED') {
        this.stopPolling(batchId);
        await this.handleBatchFailed(batchId, status, client);
        return;
      }

      if (pollData.attempts > pollData.maxAttempts) {
        logger.error('Batch polling exceeded max attempts', {
          operation: 'batch-polling-timeout',
          batchId,
          entitytype,
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

      const timeoutId = delayCall(
        this.pollBatchStatus,
        pollData.pollInterval,
        this,
        batchId
      );

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
        const timeoutId = delayCall(
          this.pollBatchStatus,
          pollData.pollInterval,
          this,
          batchId
        );
        this.pollingIntervals.set(batchId, timeoutId);
      }
    }
  }

  async handleBatchComplete(batchId, status, client) {
    if (cacheService.get(`batch:${batchId}:completed`)) return;
    cacheService.set(`batch:${batchId}:completed`, true, 300000);

    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount =
      status.processedItemsCount || status.processedCount || 0;
    const errorCount = status.failedItems?.length || status.errorCount || 0;

    const batchConfig = cacheService.get(`batch:${batchId}:config`);
    const pollData = this.activePolls.get(batchId);
    const entityType =
      pollData?.entityType || batchConfig?.entityType || 'products';

    cacheService.set(
      `batch:${batchId}:completed`,
      {
        totalItemsCount: totalCount,
        processedItemsCount: processedCount,
        entityType,
      },
      300000
    );

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

    this.stopPolling(batchId);

    const affectsProgress = pollData?.affectsProgress ?? true;
    const mode = pollData?.mode || 'unknown';

    const results = {
      batchId,
      status: 'COMPLETED',
      totalCount,
      processedCount,
      errorCount,
      entityType,
      completedAt: new Date().toISOString(),
    };

    if (!pollData?.entityType && !batchConfig?.entityType) {
      logger.warn('entityType missing for batch; defaulting to "products"', {
        batchId,
        operation: 'batch-entitytype-default',
      });
    }

    logger.info('Handling batch completion', {
      operation: 'batch-complete-handler',
      batchId,
      status: 'COMPLETED',
      processedCount: results.processedCount,
      totalCount: results.totalCount,
      entityType,
    });

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

    logger.info('🔥 Broadcasting batch completion message:', {
      payload: message,
    });

    const { ok, fail, total } = await getWs().broadcastWithRetry(message);

    logger.trace('📊 WebSocket broadcast summary', {
      operation: 'websocket-broadcast',
      batchId,
      entityType,
      totalClients: total,
      sent: ok,
      failed: fail,
    });

    cacheService.set(`batch:${batchId}:final`, results, 1800000);

    const pollDataForCompletion = this.activePolls.get(batchId);
    if (pollDataForCompletion && pollDataForCompletion.onComplete) {
      pollDataForCompletion.onComplete(results);
    }

    if (affectsProgress && mode === 'generate') {
      this.markBatchCompleteInSessions(batchId);
    }
  }

  async handleBatchFailed(batchId, status, client) {
    if (cacheService.get(`batch:${batchId}:failed`)) return;
    cacheService.set(`batch:${batchId}:failed`, true, 300000);

    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount =
      status.processedItemsCount || status.processedCount || 0;
    const errorCount = status.failedItems?.length || status.errorCount || 0;

    const batchConfig = cacheService.get(`batch:${batchId}:config`);
    const pollData = this.activePolls.get(batchId);
    const entityType =
      pollData?.entityType || batchConfig?.entityType || 'products';

    cacheService.set(
      `batch:${batchId}:failed`,
      {
        totalItemsCount: totalCount,
        processedItemsCount: processedCount,
        failedItemsLength: status.failedItems?.length,
        failedItems: status.failedItems,
        entityType,
      },
      300000
    );

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
        entityType,
      },
    });

    this.stopPolling(batchId);

    const results = {
      batchId,
      status: 'FAILED',
      totalCount,
      processedCount,
      errorCount,
      failedAt: new Date().toISOString(),
    };

    const affectsProgress = pollData?.affectsProgress ?? true;
    const mode = pollData?.mode || 'unknown';

    if (!pollData?.entityType && !batchConfig?.entityType) {
      logger.warn('entityType missing for batch; defaulting to "products"', {
        batchId,
        operation: 'batch-entitytype-default',
      });
    }

    logger.info('Handling batch failure', {
      operation: 'batch-failed-handler',
      batchId,
      status: 'FAILED',
      processedCount: results.processedCount,
      totalCount: results.totalCount,
      errorCount: results.errorCount,
      entityType,
    });

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

    const { ok, fail, total } = await getWs().broadcastWithRetry(message);

    logger.debug('📊 WebSocket broadcast summary', {
      operation: 'websocket-broadcast',
      mode,
      activityOnly: !affectsProgress,
      batchId,
      entityType,
      errorCount: results.errorCount,
      totalClients: total,
      sent: ok,
      failed: fail,
    });

    cacheService.set(`batch:${batchId}:final`, results, 1800000);

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

    logger.debug('Stopped polling for batch', {
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
