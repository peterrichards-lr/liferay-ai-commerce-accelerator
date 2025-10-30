const { ENV } = require('../utils/constants.cjs');
const {
  delayCall,
  inferEntityTypeFromClassName,
  normalizeNumber,
  delay,
  createERC,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { GENERATION_SESSION_COMPLETE } = require('../utils/wsEvents.cjs');
const { productGenerator } = require('../bootstrap.cjs');

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

    const envDefaults = {
      pollInterval: normalizeNumber(ENV.BATCH_POLL_INTERVAL, {
        min: 2000,
        defaultValue: 5000,
      }),
      minPollInterval: normalizeNumber(ENV.BATCH_POLL_MIN_INTERVAL, {
        min: 500,
        defaultValue: 2000,
      }),
      maxPollAttempts: normalizeNumber(ENV.BATCH_MAX_ATTEMPTS, {
        min: 1,
        defaultValue: 120,
      }),
      maxRetries: normalizeNumber(ENV.BATCH_MAX_RETRIES, {
        min: 0,
        defaultValue: 3,
      }),
    };

    this.pollDefaults = { ...envDefaults };

    const cfgSvc = this.ctx.configService;
    if (cfgSvc?.getBatchPollingConfigCached) {
      const cached = cfgSvc.getBatchPollingConfigCached();
      this.applyPollingConfig(cached);
    }
  }

  applyPollingConfig(input) {
    if (!input) return;
    const { logger } = this.ctx;

    let cfg = input;

    if (typeof input === 'string') {
      if (isJSON(input)) {
        cfg = tryParseJSON(input, null);
      } else {
        return;
      }
    }

    if (!cfg || typeof cfg !== 'object') return;

    const next = {
      pollInterval: normalizeNumber(cfg.pollInterval, {
        min: 1,
        defaultValue: this.pollDefaults.pollInterval,
      }),
      minPollInterval: normalizeNumber(cfg.minPollInterval, {
        min: 1,
        defaultValue: this.pollDefaults.minPollInterval,
      }),
      maxPollAttempts: normalizeNumber(cfg.maxPollAttempts, {
        min: 1,
        defaultValue: this.pollDefaults.maxPollAttempts,
      }),
      maxRetries: normalizeNumber(cfg.maxRetries, {
        min: 0,
        defaultValue: this.pollDefaults.maxRetries,
      }),
    };

    this.pollDefaults = {
      pollInterval: Math.max(this.pollDefaults.pollInterval, next.pollInterval),
      minPollInterval: Math.max(
        this.pollDefaults.minPollInterval,
        next.minPollInterval
      ),
      maxPollAttempts: Math.max(
        this.pollDefaults.maxPollAttempts,
        next.maxPollAttempts
      ),
      maxRetries: Math.max(this.pollDefaults.maxRetries, next.maxRetries),
    };

    if (this.pollDefaults.pollInterval < this.pollDefaults.minPollInterval) {
      this.pollDefaults.pollInterval = this.pollDefaults.minPollInterval;
    }

    logger?.debug?.('BatchPollingService config applied', {
      operation: 'batch-polling-config-apply',
      pollDefaults: this.pollDefaults,
    });
  }

  async refreshPollingConfigFromRemote(requestConfig) {
    const { logger, configService } = this.ctx;
    if (!configService?.getBatchPollingConfig) return;

    try {
      const remoteCfg = await configService.getBatchPollingConfig(
        requestConfig
      );
      this.applyPollingConfig(remoteCfg);
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.('BatchPollingService: failed to refresh polling config', {
        operation: 'batch-polling-config-refresh',
        errorReference,
        error: String(error?.message || error),
        correlationId: requestConfig?.correlationId,
      });
    }
  }

  registerSession(
    sessionId,
    { batchIds, totalExpected, onSessionComplete, context }
  ) {
    const { logger } = this.ctx;
    this.generationSessions.set(sessionId, {
      batchIds: new Set(batchIds || []),
      completedBatches: new Set(),
      totalExpected: totalExpected ?? (batchIds ? batchIds.length : 0),
      onSessionComplete,
      context: context || {},
      startTime: new Date(),
      sessionId,
    });

    logger.info('Registered generation session', {
      operation: 'generation-session-register',
      sessionId,
      batchIds: Array.from(batchIds || []),
      totalExpected: totalExpected,
    });
  }

  async triggerPostProcessing(sessionId, session, correlationId) {
    const { logger, cache, getWs } = this.ctx;
    try {
      logger.info('Triggering post-processing for session', {
        operation: 'post-processing-trigger',
        sessionId,
        completedBatches: Array.from(session.completedBatches),
        correlationId,
      });

      const message = {
        type: GENERATION_SESSION_COMPLETE,
        sessionId,
        completedBatches: Array.from(session.completedBatches),
        timestamp: new Date().toISOString(),
      };

      getWs().emitGenerationSessionComplete(message, { correlationId });

      const sessionContext = cache.get(`session:${sessionId}:context`);

      if (sessionContext) {
        const { config, productDataList, options } = sessionContext;

        const demoMode = sessionContext.options?.demoMode;
        const hasImages = demoMode
          ? options?.imageRatio > 0
          : options?.generateImages && options?.imageRatio > 0;
        const hasPDFs = demoMode
          ? options?.pdfRatio > 0
          : options?.generatePDFs && options?.pdfRatio > 0;
        const hasAttachments = sessionContext.productDataList?.some(
          (p) => p.defaultImage || p.defaultAttachment
        );

        if (hasImages || hasPDFs || hasAttachments) {
          await productGenerator.processImageAndPDFAttachments(
            config,
            productDataList,
            options
          );
          cache.delete(`session:${sessionId}:context`);
        }
      }
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error('Error triggering post-processing', {
        operation: 'post-processing-trigger-error',
        sessionId,
        correlationId,
        errorReference,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  startMonitors(jobs = [], globalOptions = {}) {
    const { cache } = this.ctx;
    const defaultTTL = this.ctx.cache?.defaultTTL ?? 300000;

    for (const job of jobs) {
      const { entity, refs = [], meta = {} } = job;
      const { mode = 'unknown', affectsProgress = true } = meta;

      for (const ref of refs) {
        const batchId = ref.taskId || extractIdFromLocation(ref.location);
        if (!batchId) continue;

        cache.set(
          `batch:${batchId}:config`,
          {
            correlationId:
              meta.config?.correlationId ||
              globalOptions.correlationId ||
              'unknown',
            affectsProgress,
            entityType: entity,
            mode,
          },
          defaultTTL
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

    const ef = this._effectiveOptions(options);
    const {
      pollInterval,
      maxPollAttempts,
      timeoutMs,
      onTimeout,
      onStatusChange,
      onComplete,
      onError,
      entityType,
      mode = 'unknown',
      affectsProgress = true,
    } = ef;

    if (this.activePolls.has(batchId)) {
      logger.warn('Polling already active for batch', {
        operation: 'batch-polling-start',
        batchId,
        correlationId: config?.correlationId,
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
      onTimeout,
      timeoutMs,
      entityType,
      mode,
      affectsProgress,
      startTime: new Date(),
      deadline: timeoutMs ? Date.now() + Number(timeoutMs) : null,
      timeoutTimerId: null,
    };

    if (pollData.deadline) {
      pollData.timeoutTimerId = setTimeout(() => {
        logger.error('Batch polling timed out by wall-clock', {
          operation: 'batch-polling-wall-timeout',
          batchId,
          correlationId: config?.correlationId,
          timeoutMs: pollData.timeoutMs,
        });
        try {
          if (typeof pollData.onTimeout === 'function') {
            pollData.onTimeout();
          } else if (typeof pollData.onError === 'function') {
            const err = new Error('Batch polling timed out');
            err.errorReference = createERC(ERC_PREFIX.ERROR);
            pollData.onError(err);
          }
        } finally {
          this.stopPolling(batchId);
        }
      }, pollData.timeoutMs);
    }

    this.activePolls.set(batchId, pollData);

    logger.debug('Starting batch polling', {
      operation: 'batch-polling-start',
      batchId,
      pollInterval,
      maxAttempts: maxPollAttempts,
      entityType,
      mode,
      affectsProgress,
      timeoutMs,
      correlationId: config?.correlationId,
    });

    await this.pollBatchStatus(batchId);
  }

  _effectiveOptions(overrides = {}) {
    const d = this.pollDefaults;

    let pollInterval = normalizeNumber(
      overrides.pollInterval ?? d.pollInterval,
      {
        min: d.minPollInterval,
        defaultValue: d.pollInterval,
      }
    );

    const maxPollAttempts = normalizeNumber(
      overrides.maxPollAttempts ?? d.maxPollAttempts,
      {
        min: 1,
        defaultValue: d.maxPollAttempts,
      }
    );

    const timeoutMs = normalizeNumber(
      overrides.timeoutMs ?? Math.ceil(maxPollAttempts * pollInterval * 1.5),
      { min: pollInterval * 2, defaultValue: pollInterval * 3 }
    );

    return {
      pollInterval,
      maxPollAttempts,
      timeoutMs,
      onTimeout: overrides.onTimeout,
      onStatusChange: overrides.onStatusChange,
      onComplete: overrides.onComplete,
      onError: overrides.onError,
      entityType: overrides.entityType,
      mode: overrides.mode,
      affectsProgress: overrides.affectsProgress,
    };
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

    if (pollData.deadline && Date.now() > pollData.deadline) {
      logger.error('Batch polling exceeded wall-clock deadline', {
        operation: 'batch-polling-deadline',
        batchId,
        correlationId: config?.correlationId,
      });
      try {
        if (typeof pollData.onTimeout === 'function') {
          pollData.onTimeout();
        } else if (typeof pollData.onError === 'function') {
          const err = new Error('Batch polling timed out');
          err.errorReference = createERC(ERC_PREFIX.ERROR);
          pollData.onError(err);
        }
      } finally {
        this.stopPolling(batchId);
      }
      return;
    }

    try {
      pollData.attempts++;

      const statusResponse = await liferay.getImportTask(config, batchId);
      const status = statusResponse.data;

      const batchStatus = status.executeStatus || 'UNKNOWN';
      const entitytype = inferEntityTypeFromClassName(status.className);
      const totalCount = status.totalItemsCount || 0;
      const processedCount = status.processedItemsCount || 0;
      const errorCount = status.failedItems?.length || 0;

      const defaultTTL = this.ctx.cache?.defaultTTL ?? 300000;

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
        defaultTTL
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
        const errMsg = `Batch polling timed out after ${pollData.maxAttempts} attempts`;
        const errRef = createERC(ERC_PREFIX.ERROR);

        logger.error('Batch polling exceeded max attempts', {
          operation: 'batch-polling-timeout',
          batchId,
          correlationId: config?.correlationId,
          entitytype,
          attempts: pollData.attempts,
          maxAttempts: pollData.maxAttempts,
          errorReference: errRef,
          message: errMsg,
        });

        if (pollData.onError) {
          const err = new Error(errMsg);
          err.errorReference = errRef;
          pollData.onError(err);
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
      const httpStatus = error?.response?.status;
      const message = String(error?.message || error);
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger.error('Error polling batch status', {
        operation: 'batch-polling-error',
        batchId,
        correlationId: config?.correlationId,
        errorReference,
        message,
        httpStatus,
        attempt: pollData.attempts,
      });

      if (pollData.onError) {
        if (!error.errorReference) {
          error.errorReference = errorReference;
        }
        pollData.onError(error);
      }

      const shouldStopPolling =
        message.includes('401') ||
        message.includes('404') ||
        message.includes('406') ||
        pollData.attempts >= pollData.maxAttempts;

      if (shouldStopPolling) {
        logger.warn('Stopping polling due to error condition', {
          operation: 'batch-polling-stop-error',
          batchId,
          correlationId: config?.correlationId,
          errorReference,
          message,
          attempts: pollData.attempts,
          httpStatus,
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

    const defaultTTL = this.ctx.cache?.defaultTTL ?? 300000;
    cache.set(`batch:${batchId}:completed`, true, defaultTTL);

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
    const operation =
      pollData?.operation || batchConfig?.operation || 'unknown';

    cache.set(
      `batch:${batchId}:completed`,
      {
        correlationId,
        totalItemsCount: totalCount,
        processedItemsCount: processedCount,
        entityType,
        mode,
        operation,
      },
      defaultTTL
    );

    logger.info('Batch completed successfully', {
      operation: 'batch-complete',
      batchId,
      correlationId,
      totalCount,
      processedCount,
      errorCount,
      mode,
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
      operation,
      completedAt: new Date().toISOString(),
    };

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
        operation,
        activityOnly: !affectsProgress,
      },
      correlationId,
    };

    const stats = (await getWs().emitBatchCompleted(message)) || {};
    const { ok = 0, fail = 0, total = 0 } = stats;

    cache.set(`batch:${batchId}:final`, results, 1800000);

    const pollDataForCompletion = this.activePolls.get(batchId);
    if (pollDataForCompletion?.onComplete) {
      pollDataForCompletion.onComplete(results);
    }

    if (affectsProgress && mode === 'generate' && entityType === 'products') {
      this.markBatchCompleteInSessions(batchId, correlationId);
    }
  }

  async handleBatchFailed(batchId, status) {
    const { logger, cache, getWs } = this.ctx;
    if (cache.get(`batch:${batchId}:failed`)) return;

    const defaultTTL = this.ctx.cache?.defaultTTL ?? 300000;
    cache.set(`batch:${batchId}:failed`, true, defaultTTL);

    const totalCount = status.totalItemsCount || status.totalCount || 0;
    const processedCount =
      status.processedItemsCount || status.processedCount || 0;
    const errorCount = status.failedItems?.length || status.errorCount || 0;

    const batchConfig = cache.get(`batch:${batchId}:config`);
    const pollData = this.activePolls.get(batchId);
    const affectsProgress = pollData?.affectsProgress ?? true;
    const mode = pollData?.mode || 'unknown';
    const operation =
      pollData?.operation || batchConfig?.operation || 'unknown';
    const entityType =
      pollData?.entityType || batchConfig?.entityType || 'products';
    const correlationId =
      pollData?.correlationId || batchConfig?.correlationId || 'unknown';

    cache.set(
      `batch:${batchId}:failed`,
      {
        correlationId,
        totalItemsCount: totalCount,
        processedItemsCount: processedCount,
        failedItemsLength: status.failedItems?.length,
        failedItems: status.failedItems,
        entityType,
        operation,
      },
      defaultTTL
    );

    logger.error('Batch failed', {
      operation: 'batch-failed',
      batchId,
      correlationId,
      totalCount,
      processedCount,
      errorCount,
      mode,
      operation,
    });

    this.stopPolling(batchId);

    const results = {
      correlationId,
      batchId,
      status: 'FAILED',
      totalCount,
      processedCount,
      errorCount,
      mode,
      operation,
      failedAt: new Date().toISOString(),
    };

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
        mode,
        operation,
      },
      correlationId: results.correlationId,
    };

    const stats = (await getWs().emitBatchFailed(message)) || {};
    const { ok = 0, fail = 0, total = 0 } = stats;

    cache.set(`batch:${batchId}:final`, results, 1800000);

    const pollDataForFailure = this.activePolls.get(batchId);
    if (pollDataForFailure?.onError) {
      const err = new Error(
        `Batch failed with ${status.errorCount || 0} errors`
      );
      err.errorReference = createERC(ERC_PREFIX.ERROR);
      pollDataForFailure.onError(err);
    }
  }

  stopPolling(batchId) {
    const { logger } = this.ctx;
    const timeoutId = this.pollingIntervals.get(batchId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pollingIntervals.delete(batchId);
    }

    const pollData = this.activePolls.get(batchId);
    if (pollData?.timeoutTimerId) {
      clearTimeout(pollData.timeoutTimerId);
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

  markBatchCompleteInSessions(batchId, correlationId) {
    const { logger } = this.ctx;
    for (const [sessionId, session] of this.generationSessions.entries()) {
      if (!session.batchIds.has(batchId)) continue;

      session.completedBatches.add(batchId);

      const allDone =
        session.completedBatches.size >= session.totalExpected &&
        session.totalExpected > 0;

      if (allDone) {
        logger.info('Generation session completed - all batches finished', {
          operation: 'generation-session-complete',
          correlationId,
          sessionId,
          totalBatches: session.batchIds.size,
          completedBatches: session.completedBatches.size,
        });

        const hook = session.onSessionComplete;
        const ctx = session.context;
        const sessionSnapshot = { ...session };

        this.generationSessions.delete(sessionId);

        if (typeof hook === 'function') {
          Promise.resolve()
            .then(() =>
              hook({ sessionId, session: sessionSnapshot, correlationId })
            )
            .catch((err) => {
              const errorReference =
                err.errorReference || createERC(ERC_PREFIX.ERROR);
              logger?.error?.('onSessionComplete failed', {
                operation: 'post-processing-hook-error',
                sessionId,
                correlationId,
                errorReference,
                message: err.message,
                stack: err.stack,
              });
            });
        }
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
