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
   */
  _getOwnerGenerator(session) {
    const { flow_type: flowType, context } = session;

    // 1. Explicit generator key (new standard)
    if (context?.generator && this.generators[context.generator]) {
      return this.generators[context.generator];
    }

    // 2. Fallback to flow_type mapping
    const map = {
      generate: 'product',
      accounts: 'account',
      orders: 'order',
      warehouses: 'warehouse',
      delete: 'delete',
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
   * Probes Liferay for active batches of incomplete sessions and resumes workflows.
   * Useful for recovery after microservice restarts.
   */
  async recoverOrphanedSessions() {
    const { logger, persistence, liferay } = this.ctx;
    const incomplete = await persistence.getIncompleteSessions();

    if (incomplete.length === 0) return;

    logger.info(`Starting recovery probe for ${incomplete.length} sessions...`);

    for (const session of incomplete) {
      const { session_id: sessionId, correlationId } = session;
      const batches = await persistence.getBatchesForSession(sessionId);

      // 1. Find batches that might have finished while we were down
      const activeBatches = batches.filter(
        (b) =>
          ['SUBMITTED', 'PENDING', 'PROCESSING'].includes(b.status) &&
          b.downstream_batch_id
      );

      for (const b of activeBatches) {
        try {
          logger.info(`Probing Liferay status for batch ${b.erc}...`, {
            batchId: b.downstream_batch_id,
            sessionId,
          });

          const task = await liferay.getImportTask(
            session.context.config,
            b.downstream_batch_id
          );

          if (
            task &&
            ['COMPLETED', 'FAILED'].includes(task.executeStatus || task.status)
          ) {
            logger.success(
              `Batch ${b.erc} completed while offline. Reconciling...`
            );

            // Map Liferay executeStatus to our status
            let status =
              (task.executeStatus || task.status) === 'COMPLETED'
                ? 'COMPLETED'
                : 'FAILED';

            // HARDENING: Check for partial failures during recovery
            if (
              status === 'COMPLETED' &&
              (task.failedItems?.length > 0 ||
                (task.processedItemsCount < task.totalItemsCount &&
                  task.totalItemsCount > 0))
            ) {
              logger.warn(
                `Recovered batch ${b.erc} has partial failures. Marking as FAILED.`
              );
              status = 'FAILED';
            }

            await this.processCallbackInternal(
              b.erc,
              {
                id: b.downstream_batch_id,
                status,
                processedItemsCount: task.processedItemsCount,
                totalItemsCount: task.totalItemsCount,
              },
              correlationId,
              sessionId
            );
          }
        } catch (err) {
          logger.warn(`Failed to probe batch ${b.erc}: ${err.message}`, {
            sessionId,
          });
        }
      }

      // 2. Regardless of batch updates, trigger a completion check
      // to wake up the orchestration loop for this session.
      // This handles cases where batches were already finished or no batches were pending.
      await this._checkSessionCompletion(sessionId, correlationId);
    }

    logger.info('Orphaned session recovery complete.');
  }

  /**
   * Main entry point for session advancement checks.
   * Uses a session-scoped promise chain to ensure atomic execution per session.
   */
  async _checkSessionCompletion(sessionId, correlationId) {
    this.ctx.logger.info(`Checking session completion for ${sessionId}...`);
    // 1. Get or create the lock for this session
    const existingLock = this.sessionLocks.get(sessionId) || Promise.resolve();

    // 2. Chain the new check to the end of the existing processing
    const newLock = existingLock
      .then(async () => {
        await this._executeCheckWithLock(sessionId, correlationId);
      })
      .catch((err) => {
        // Errors in the chain shouldn't kill the service
        this.ctx.logger.error(
          `Error in session lock chain for ${sessionId}: ${err.message}`,
          { sessionId }
        );
      })
      .finally(() => {
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
        if (!session) {
          logger.warn(
            `No session found for ID ${sessionId}. Orchestrator cannot proceed.`,
            { sessionId }
          );
          break;
        }
        if (session.status === 'COMPLETED' || session.status === 'FAILED') {
          break;
        }

        const generator = this._getOwnerGenerator(session);
        if (!generator) {
          logger.error(
            `No generator registered for flow type '${session.flow_type}'`,
            { sessionId }
          );
          await persistence.updateSession(sessionId, { status: 'FAILED' });
          break;
        }

        try {
          this.ctx.logger.info(
            `Advancing session ${sessionId} via ${generator.constructor.name}...`
          );
          // Delegate step advancement to the specialized generator
          await generator.executeNextStep(sessionId);
        } catch (stepErr) {
          logger.error(
            `Critical error advancing workflow for session ${sessionId}: ${stepErr.message}`,
            {
              sessionId,
              error: stepErr.message,
              stack: stepErr.stack,
            }
          );

          // Propagate failure to the database
          if (
            await persistence.tryFailSession(
              sessionId,
              stepErr.message,
              null,
              stepErr.stack
            )
          ) {
            const { correlationId: sessionCid } = session;
            await this.ctx.progress.sessionFailed({
              sessionId,
              correlationId: correlationId || sessionCid,
              error: {
                message: stepErr.message,
                stack: stepErr.stack,
              },
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
      logger.error(
        `Fatal error in _executeCheckWithLock for ${sessionId}: ${err.message}`,
        { sessionId }
      );
    }
  }

  /**
   * Public entry point for callbacks.
   * Enqueues the callback for processing via the QueueService to handle race conditions.
   */
  async processCallback(
    batchERC,
    payload,
    correlationId = null,
    sessionId = null
  ) {
    const { logger, queue } = this.ctx;
    const { JOB_TYPES, QUEUE_CONFIG } = require('../utils/constants.cjs');

    logger.info('Enqueuing batch callback for processing', {
      batchERC,
      correlationId,
      sessionId,
      targetQueue: 'batch-callback',
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
      await this.processCallbackInternal(
        batchERC,
        payload,
        correlationId,
        sessionId
      );
    }
  }

  /**
   * Internal implementation of callback processing.
   * Throws an error if the batch record is not found to trigger queue retries.
   */
  async processCallbackInternal(
    batchERC,
    payload,
    correlationId = null,
    providedSessionId = null
  ) {
    const { logger, liferay, persistence, progress } = this.ctx;

    // 1. Resolve Batch and Session
    const dbBatch = await persistence.getBatch(batchERC);

    if (!dbBatch) {
      // Throwing a specific message helps with log filtering and triggers queue retry
      throw new Error(
        `[RETRYABLE] Batch record not yet persisted for ERC: ${batchERC}. Callback arrived too fast.`
      );
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
      if (
        finalStatus === 'COMPLETED' &&
        processedCount === 0 &&
        totalCount > 0
      ) {
        logger.error(
          'Batch completed with 0 items processed - marking as FAILED',
          {
            batchERC,
            batchId,
            totalCount,
            errorMessage: data.errorMessage,
            sessionId,
          }
        );
        finalStatus = 'FAILED';
      }

      // Case B: Liferay says COMPLETED but there are partial failures
      if (finalStatus === 'COMPLETED' && errorCount > 0) {
        logger.error(
          'Batch completed with partial failures - marking as FAILED for strict reliability',
          {
            batchERC,
            batchId,
            errorCount,
            totalCount,
            sessionId,
          }
        );
        finalStatus = 'FAILED';
      }

      // Fetch detailed errors if there are any failures or if processed < total
      if (processedCount < totalCount || errorCount > 0) {
        try {
          const failureReport = await liferay.getImportTaskFailedItemReport(
            config,
            batchId
          );
          if (failureReport && failureReport.length > 0) {
            const firstFailure = failureReport[0];
            const errorMessage =
              firstFailure.errorMessage ||
              firstFailure.error ||
              'Unknown error';

            logger.info('Detailed batch failure detected', {
              batchId,
              firstError: errorMessage,
              sessionId,
            });

            // CRITICAL: Log full raw content if error is unknown to help schema mapping
            if (errorMessage.toLowerCase().includes('unknown error')) {
              logger.error('Full failed item content for investigation:', {
                batchId,
                rawContent: firstFailure.content || firstFailure,
                sessionId,
              });
            }

            // Broadcast detailed errors to UI
            progress.emitBatchItemsFailed({
              sessionId: session.session_id,
              batchERC,
              batchId,
              entityType: generator
                ? generator._normalizeEntityType(dbBatch.step_key)
                : dbBatch.step_key,
              operation: session.flow_type,
              failedItems: failureReport,
              correlationId: effectiveCorrelationId,
            });

            // PERSISTENCE: Log detailed failure as a workflow event for audit history
            persistence.logWorkflowEvent({
              sessionId: session.session_id,
              batchId,
              status: 'FAILED',
              message: `Batch ${batchId} for ${dbBatch.step_key} had ${errorCount} failures. First error: ${errorMessage}`,
              details: {
                batchERC,
                stepKey: dbBatch.step_key,
                errorCount,
                totalCount,
                failedItems: failureReport.slice(0, 50), // Cap details to prevent DB bloat
              },
            });
          } else {
            // HARDENING: If report is empty but processed < total, log a specific warning
            persistence.logWorkflowEvent({
              sessionId: session.session_id,
              batchId,
              status: 'FAILED',
              message: `Batch ${batchId} for ${dbBatch.step_key} is incomplete: processed ${processedCount} of ${totalCount} items, but no individual errors were reported by Liferay.`,
              details: {
                batchERC,
                stepKey: dbBatch.step_key,
                processedCount,
                totalCount,
                liferayStatus: data.executeStatus || 'UNKNOWN',
              },
            });
          }
        } catch (reportErr) {
          logger.warn(
            'Failed to fetch detailed batch failure report for broadcast',
            { batchId, error: reportErr.message }
          );
        }
      }

      await persistence.updateBatch(batchERC, {
        status: finalStatus,
        processedCount: processedCount,
        totalCount: totalCount,
        errorCount: errorCount,
        errorMessage: data.errorMessage,
        downstreamBatchId: batchId,
      });

      // 4. Delegate Step-Specific Logic (Verification, etc.)
      if (generator && finalStatus === 'COMPLETED') {
        await generator.handleBatchCallback(session.session_id, batchERC);
      }

      // 5. Broadcast Progress
      if (finalStatus === 'FAILED') {
        progress.batchFailed({
          entityType: generator
            ? generator._normalizeEntityType(dbBatch.step_key)
            : dbBatch.step_key,
          operation: session.flow_type,
          batchId,
          batchERC,
          sessionId: session.session_id,
          error: {
            message:
              data.errorMessage ||
              `Batch is incomplete: processed ${processedCount} of ${totalCount} items.`,
          },
          correlationId: effectiveCorrelationId,
        });
      } else if (finalStatus === 'COMPLETED') {
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
      }

      // 5.5 Broadcast Step Completed if all batches for this step are done
      const sessionBatches = await persistence.getBatchesForSession(
        session.session_id
      );
      const stepBatches = sessionBatches.filter(
        (b) => b.step_key === dbBatch.step_key
      );
      const isTerminal = (b) =>
        ['COMPLETED', 'FAILED', 'BYPASSED', 'SYNCHRONOUS'].includes(b.status);

      if (
        stepBatches.length > 0 &&
        stepBatches.every(isTerminal) &&
        !stepBatches.some((b) => b.status === 'FAILED')
      ) {
        const totalStepCount = stepBatches.reduce(
          (sum, b) => sum + (b.total_count || 0),
          0
        );
        progress.stepCompleted({
          sessionId: session.session_id,
          step: dbBatch.step_key,
          entityType: generator
            ? generator._normalizeEntityType(dbBatch.step_key)
            : dbBatch.step_key,
          operation: session.flow_type,
          totalCount: totalStepCount,
          correlationId: effectiveCorrelationId,
        });
      }

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
