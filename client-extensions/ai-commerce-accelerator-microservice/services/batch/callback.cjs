const { delay } = require('../../utils/misc.cjs');

class BatchCallbackService {
  constructor(ctx) {
    this.ctx = ctx;
    this.generators = {}; // Registry for BaseGenerator instances
    this.processingSessions = new Set();
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
   * Now delegates core orchestration to the owner generator.
   */
  async _checkSessionCompletion(sessionId, correlationId) {
    const { logger, persistence } = this.ctx;

    if (this.processingSessions.has(sessionId)) {
      this.sessionDirtyFlags.add(sessionId);
      logger.debug('Session already being processed, marked as dirty.', { sessionId, correlationId: correlationId || 'system' });
      return;
    }

    this.processingSessions.add(sessionId);

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
          // Avoid tight loop on failure
          continueLoop = false;
          break;
        }

        if (!this.sessionDirtyFlags.has(sessionId)) {
          continueLoop = false;
        }
      }
    } catch (err) {
      logger.error(`Fatal error in _checkSessionCompletion for ${sessionId}: ${err.message}`, { sessionId });
    } finally {
      this.processingSessions.delete(sessionId);
    }
  }

  /**
   * Public entry point for callbacks.
   * Enqueues the callback for processing via the QueueService to handle race conditions.
   */
  async processCallback(batchERC, payload, correlationId = null) {
    const { logger, queue } = this.ctx;
    const { JOB_TYPES, QUEUE_CONFIG } = require('../../utils/constants.cjs');

    logger.info('Enqueuing batch callback for processing', {
      batchERC,
      correlationId,
    });

    try {
      await queue.add(
        'default',
        JOB_TYPES.BATCH_CALLBACK_PROCESSING,
        {
          batchERC,
          payload,
          correlationId,
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
        error: error.message,
      });
      // Fallback to immediate processing if queue fails
      await this.processCallbackInternal(batchERC, payload, correlationId);
    }
  }

  /**
   * Internal implementation of callback processing.
   * Throws an error if the batch record is not found to trigger queue retries.
   */
  async processCallbackInternal(batchERC, payload, correlationId = null) {
    const { logger, liferay, persistence, progress } = this.ctx;

    // 1. Resolve Batch and Session
    const dbBatch = await persistence.getBatch(batchERC);

    if (!dbBatch) {
      // Throwing error here is critical for QueueService to retry
      throw new Error(`Batch record not found for ERC: ${batchERC}`);
    }

    const session = await persistence.getSession(dbBatch.session_id);
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
      const finalStatus = (
        data.executeStatus || payload[batchId]
      ).toUpperCase();

      await persistence.updateBatch(batchERC, {
        status: finalStatus,
        processedCount: data.processedItemsCount || 0,
        totalCount: data.totalItemsCount || 0,
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
