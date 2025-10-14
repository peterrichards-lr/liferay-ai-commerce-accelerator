const axios = require('axios');
const {
  delayCall,
  inferEntityTypeFromClassName,
} = require('../utils/misc.cjs');
const {
  GENERATION_SESSION_COMPLETE,
} = require('../utils/wsEvents.cjs');

function extractIdFromLocation(location) {
  if (!location || typeof location !== 'string') return null;
  const m = location.match(/\/import-task\/(\d+)/);
  return m ? m[1] : null;
}

class BatchPollingService {
  constructor(ctx) {
    this.ctx = ctx;
    this.pollingIntervals = new Map();
    this.activePolls = new Map();
    this.generationSessions = new Map();
  }

  registerGenerationSession(sessionId, batchIds, totalExpectedBatches) {
    const { logger } = this.ctx;
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
    const { logger } = this.ctx;
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
    const { logger, cache } = this.ctx;
    try {
      logger.info('Triggering post-processing for session', {
        operation: 'post-processing-trigger',
        sessionId,
        completedBatches: Array.from(session.completedBatches),
      });

      const message = {
        type: GENERATION_SESSION_COMPLETE,
        sessionId,
        completedBatches: Array.from(session.completedBatches),
        timestamp: new Date().toISOString(),
      };

      getWs().broadcase(message);

      logger.info(
        `🎉 Generation session ${sessionId} completed - ready for post-processing!`
      );

      const sessionContext = cache.get(`session:${sessionId}:context`);

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

          cache.delete(`session:${sessionId}:context`);
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
    const { cache } = this.ctx;
    for (const job of jobs) {
      const { entity, refs = [], meta = {} } = job;
      const { mode = 'unknown', affectsProgress = true } = meta;

      for (const ref of refs) {
        const batchId = ref.taskId || extractIdFromLocation(ref.location);
        if (!batchId) continue;

        cache.set(
          `batch:${batchId}:config`,
          {
            correlationId: config.correlationId,
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
    const { logger } = this.ctx;
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
    const { logger, liferay, cache } = this.ctx;
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

      const statusResponse = await liferay.getImportTask(config, batchId);
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

      cache.set(
        `batch:${batchId}:status`,
        {
          correlationId: config?.correlationId ?? 'unknown',
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
        await this.handleBatchComplete(batchId, status);
        return;
      } else if (batchStatus === 'FAILED') {
        this.stopPolling(batchId);
        await this.handleBatchFailed(batchId, status);
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

  async handleBatchComplete(batchId, status) {
    const { logger, cache, getWs } = this.ctx;
    if (cache.get(`batch:${batchId}:completed`)) return;
    cache.set(`batch:${batchId}:completed`, true, 300000);

    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount =
      status.processedItemsCount || status.processedCount || 0;
    const errorCount = status.failedItems?.length || status.errorCount || 0;

    const batchConfig = cache.get(`batch:${batchId}:config`);
    const pollData = this.activePolls.get(batchId);
    const entityType =
      pollData?.entityType || batchConfig?.entityType || 'products';
    const affectsProgress = pollData?.affectsProgress ?? true;
    const mode = pollData?.mode || batchConfig?.mode || 'unknown';
    const correlationId = batchConfig?.correlationId || 'unknown';

    cache.set(
      `batch:${batchId}:completed`,
      {
        correlationId,
        totalItemsCount: totalCount,
        processedItemsCount: processedCount,
        entityType,
        mode,
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

    const results = {
      correlationId,
      batchId,
      status: 'COMPLETED',
      totalCount,
      processedCount,
      errorCount,
      entityType,
      mode,
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
      batchId,
      entityType,
      successCount: results.processedCount,
      failureCount: results.errorCount,
      details: {
        status: results.status,
        totalCount: results.totalCount,
        processedCount: results.processedCount,
        errorCount: results.errorCount,
        completedAt: results.completedAt,
        mode,
        activityOnly: !affectsProgress,
      },
      correlationId,
    };

    logger.info('🔥 Broadcasting batch completion message:', {
      payload: message,
    });

    const { ok, fail, total } = await getWs().emitBatchCompleted(message);

    logger.trace('📊 WebSocket broadcast summary', {
      operation: 'websocket-broadcast',
      batchId,
      entityType,
      totalClients: total,
      sent: ok,
      failed: fail,
    });

    cache.set(`batch:${batchId}:final`, results, 1800000);

    const pollDataForCompletion = this.activePolls.get(batchId);
    if (pollDataForCompletion && pollDataForCompletion.onComplete) {
      pollDataForCompletion.onComplete(results);
    }

    if (affectsProgress && mode === 'generate') {
      this.markBatchCompleteInSessions(batchId);
    }
  }

  async handleBatchFailed(batchId, status) {
    const { logger, cache, getWs } = this.ctx;
    if (cache.get(`batch:${batchId}:failed`)) return;
    cache.set(`batch:${batchId}:failed`, true, 300000);

    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount =
      status.processedItemsCount || status.processedCount || 0;
    const errorCount = status.failedItems?.length || status.errorCount || 0;

    const batchConfig = cache.get(`batch:${batchId}:config`);
    const pollData = this.activePolls.get(batchId);
    const affectsProgress = pollData?.affectsProgress ?? true;
    const mode = pollData?.mode || 'unknown';
    const entityType =
      pollData?.entityType || batchConfig?.entityType || 'products';

    cache.set(
      `batch:${batchId}:failed`,
      {
        correlationId: config.correlationId,
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
      correlationId: config.correlationId,
      batchId,
      status: 'FAILED',
      totalCount,
      processedCount,
      errorCount,
      mode,
      failedAt: new Date().toISOString(),
    };

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
      mode,
      correlationId: results.correlationId,
    });

    const message = {
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
      correlationId: results.correlationId,
    };

    const { ok, fail, total } = await getWs().emitBatchFailed(message);

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

    cache.set(`batch:${batchId}:final`, results, 1800000);

    const pollDataForFailure = this.activePolls.get(batchId);
    if (pollDataForFailure && pollDataForFailure.onError) {
      pollDataForFailure.onError(
        new Error(`Batch failed with ${status.errorCount || 0} errors`)
      );
    }
  }

  stopPolling(batchId) {
    const { logger } = this.ctx;
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
    const { logger } = this.ctx;
    for (const batchId of this.activePolls.keys()) {
      this.stopPolling(batchId);
    }
    logger.info('Stopped all batch polling', {
      operation: 'batch-polling-stop-all',
    });
  }
}

module.exports = BatchPollingService;
