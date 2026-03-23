const { delay } = require('../../utils/misc.cjs');

class BatchCallbackService {
  constructor(ctx) {
    this.ctx = ctx;
    this.generators = {}; // Registry for BaseGenerator instances
    this.sessionLocks = new Map(); // sessionId -> Promise (the current processing chain)
    this.sessionDirtyFlags = new Set();
  }

  /**
   * Registers a generator instance into the dispatcher.
   */
  registerGenerator(name, instance) {
    this.generators[name] = instance;
  }

  /**
   * Identifies the owner generator for a given session.
   * Typically based on the session.flow_type.
   */
  _getOwnerGenerator(session) {
    const { flow_type: flowType } = session;
    
    // Mapping flow types to registry keys
    const map = {
      'generate': 'product',
      'accounts': 'account',
      'orders': 'order',
      'warehouses': 'warehouse',
      'delete': 'delete'
    };

    const key = map[flowType] || flowType;
    return this.generators[key];
  }

  async getBatchStatus(batchId) {
    const { persistence } = this.ctx;
    const batch = await persistence.getBatchByDownstreamId(batchId);
    if (!batch) return { status: 'UNKNOWN' };
    return {
      status: batch.status,
      processedCount: batch.processed_count,
      totalCount: batch.total_count,
      errorCount: batch.error_count,
      stepKey: batch.step_key,
      sessionId: batch.session_id,
    };
  }

  /**
   * Main entry point for session advancement checks.
   * Uses a session-scoped promise chain to ensure atomic execution per session.
   */
  async _checkSessionCompletion(sessionId, correlationId) {
    // 1. Get or create the lock for this session
    const existingLock = this.sessionLocks.get(sessionId) || Promise.resolve();

    // 2. Chain the new check to the end of the existing processing
    const newLock = existingLock.then(async () => {
      await this._executeCheckWithLock(sessionId, correlationId);
    }).catch(err => {
      // Errors in the chain shouldn't kill the service
      this.ctx.logger.error(`Error in session lock chain for ${sessionId}: ${err.message}`, { sessionId });
    }).finally(() => {
      // Cleanup: if this was the last link in the chain, remove the entry from the map
      if (this.sessionLocks.get(sessionId) === newLock) {
        this.sessionLocks.delete(sessionId);
      }
    });

    this.sessionLocks.set(sessionId, newLock);
    return newLock;
  }

  /**
   * Internal implementation of the session check, guaranteed to be called
   * only once at a time per sessionId via the promise chain.
   */
  async _executeCheckWithLock(sessionId, correlationId) {
    const { logger, persistence } = this.ctx;

    try {
      let continueLoop = true;
      while (continueLoop) {
        this.sessionDirtyFlags.delete(sessionId);

        const session = await persistence.getSession(sessionId);
        if (!session || session.status === 'COMPLETED' || session.status === 'FAILED') {
          break;
        }

        const generator = this._getOwnerGenerator(session);
        if (!generator) {
          logger.error(`No generator registered for flow type '${session.flow_type}'`, { sessionId });
          await persistence.updateSession(sessionId, { status: 'FAILED' });
          break;
        }

        try {
          // Delegate step advancement to the specialized generator
          await generator.executeNextStep(sessionId);
        } catch (stepErr) {
          logger.error(`Critical error advancing workflow for session ${sessionId}: ${stepErr.message}`, { 
            sessionId,
            error: stepErr.message,
            stack: stepErr.stack
          });
          
          // Propagate failure to the database
          if (await persistence.tryFailSession(sessionId)) {
            const { correlationId: sessionCid } = session;
            this.ctx.progress.sessionFailed({
              sessionId,
              correlationId: correlationId || sessionCid,
              error: { message: stepErr.message }
            });
          }

          // Avoid tight loop on failure
          continueLoop = false;
          break;
        }

        // If something else marked this session as dirty during our run, loop again
        if (!this.sessionDirtyFlags.has(sessionId)) {
          continueLoop = false;
        }
      }
    } catch (err) {
      logger.error(`Fatal error in _executeCheckWithLock for ${sessionId}: ${err.message}`, { sessionId });
    }
  }

  /**
   * Public entry point for callbacks.
   * Enqueues the callback for processing via the QueueService to handle race conditions.
   */
  async processCallback(batchERC, payload, correlationId = null, sessionId = null) {
    const { logger, queue } = this.ctx;
    const { JOB_TYPES, QUEUE_CONFIG } = require('../../utils/constants.cjs');

    logger.info('Enqueuing batch callback for processing', {
      batchERC,
      correlationId,
      sessionId,
      targetQueue: 'batch-callback'
    });

    try {
      await queue.add(
        'batch-callback',
        JOB_TYPES.BATCH_CALLBACK_PROCESSING,
        {
          batchERC,
          payload,
          correlationId,
          sessionId,
        },
        {
          retries: QUEUE_CONFIG.CALLBACK_MAX_RETRIES,
          retryDelay: QUEUE_CONFIG.CALLBACK_RETRY_DELAY,
          correlationId,
        }
      );
    } catch (error) {
      logger.error('Failed to enqueue batch callback', {
        batchERC,
        correlationId,
        sessionId,
        error: error.message,
      });
      // Fallback to immediate processing if queue fails
      await this.processCallbackInternal(batchERC, payload, correlationId, sessionId);
    }
  }

  /**
   * Internal implementation of callback processing.
   * Throws an error if the batch record is not found to trigger queue retries.
   */
  async processCallbackInternal(batchERC, payload, correlationId = null, providedSessionId = null) {
    const { logger, liferay, persistence, progress } = this.ctx;

    // 1. Resolve Batch and Session
    const dbBatch = await persistence.getBatch(batchERC);

    if (!dbBatch) {
      // Throwing a specific message helps with log filtering and triggers queue retry
      throw new Error(`[RETRYABLE] Batch record not yet persisted for ERC: ${batchERC}. Callback arrived too fast.`);
    }

    const sessionId = providedSessionId || dbBatch.session_id;
    const session = await persistence.getSession(sessionId);
    if (!session) {
      logger.error('Orphaned batch detected - no session found', {
        batchERC,
        sessionId: dbBatch.session_id,
      });
      return;
    }

    const generator = this._getOwnerGenerator(session);
    const { config } = session.context;
    const effectiveCorrelationId = correlationId || session.correlationId;

    const batchId = Object.keys(payload)[0];
    if (!batchId) {
      logger.error('Could not extract batchId from callback payload', {
        batchERC,
      });
      return;
    }

    try {
      // 2. Retrieve final state from Liferay REST API
      const importTask = await liferay.getImportTask(config, batchId);
      const data = importTask?.data || importTask;

      // 3. Update Batch State
      const errorCount = data.failedItems?.length || 0;
      const processedCount = data.processedItemsCount || 0;
      const totalCount = data.totalItemsCount || 0;
      let finalStatus = (data.executeStatus || payload[batchId]).toUpperCase();

      // --- HARDENING: Strict Error Detection ---

      // Case A: Liferay says COMPLETED but processed 0 items out of N (Global Failure)
      if (finalStatus === 'COMPLETED' && processedCount === 0 && totalCount > 0) {
        logger.error('Batch completed with 0 items processed - marking as FAILED', {
          batchERC,
          batchId,
          totalCount,
          errorMessage: data.errorMessage
        });
        finalStatus = 'FAILED';
      }

      // Case B: Liferay says COMPLETED but there are partial failures
      if (finalStatus === 'COMPLETED' && errorCount > 0) {
        logger.error('Batch completed with partial failures - marking as FAILED for strict reliability', {
          batchERC,
          batchId,
          errorCount,
          totalCount
        });
        finalStatus = 'FAILED';
      }

      // Fetch detailed errors if there are any failures or if processed < total
      if (processedCount < totalCount || errorCount > 0) {
        try {
          const failureReport = await liferay.getImportTaskFailedItemReport(config, batchId);
          if (failureReport && failureReport.length > 0) {
            const firstFailure = failureReport[0];
            const errorMessage = firstFailure.errorMessage || firstFailure.error || 'Unknown error';
            
            logger.info('Detailed batch failure detected', { 
              batchId, 
              firstError: errorMessage 
            });

            // CRITICAL: Log full raw content if error is unknown to help schema mapping
            if (errorMessage.toLowerCase().includes('unknown error')) {
              logger.error('Full failed item content for investigation:', {
                batchId,
                rawContent: firstFailure.content || firstFailure
              });
            }
            
            // Broadcast detailed errors to UI
            progress.emitBatchItemsFailed({
              sessionId: session.session_id,
              batchERC,
              batchId,
              entityType: generator ? generator._normalizeEntityType(dbBatch.step_key) : dbBatch.step_key,
              operation: session.flow_type,
              failedItems: failureReport,
              correlationId: effectiveCorrelationId,
            });
          }
        } catch (reportErr) {
          logger.warn('Failed to fetch detailed batch failure report for broadcast', { batchId, error: reportErr.message });
        }
      }

      await persistence.updateBatch(batchERC, {
        status: finalStatus,
        processedCount: processedCount,
        totalCount: totalCount,
        errorCount: errorCount,
        downstreamBatchId: batchId,
      });

      // 4. Delegate Step-Specific Logic (Verification, etc.)
      if (generator && finalStatus === 'COMPLETED') {
        await generator.handleBatchCallback(session.session_id, batchERC);
      }

      // 5. Broadcast Progress
      progress.batchCompleted({
        entityType: generator
          ? generator._normalizeEntityType(dbBatch.step_key)
          : dbBatch.step_key,
        operation: session.flow_type,
        batchId,
        batchERC,
        sessionId: session.session_id,
        successCount: data.processedItemsCount || 0,
        failureCount: errorCount,
        correlationId: effectiveCorrelationId,
      });

      // 6. Trigger Advancement
      await this._checkSessionCompletion(
        session.session_id,
        effectiveCorrelationId
      );
    } catch (error) {
      logger.error('Error processing batch callback', {
        batchERC,
        error: error.message,
      });
      await persistence.updateBatch(batchERC, { status: 'FAILED' });
      progress.batchFailed({
        sessionId: session.session_id,
        batchERC,
        batchId,
        error,
        correlationId: effectiveCorrelationId,
      });
    }
  }
}

module.exports = BatchCallbackService;
