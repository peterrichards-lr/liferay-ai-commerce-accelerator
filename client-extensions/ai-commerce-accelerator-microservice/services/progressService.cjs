const { resolvePhaseAndMode } = require('../utils/misc.cjs');

class ProgressService {
  constructor({ ws, logger, persistence }) {
    this.ws = ws;
    this.logger = logger;
    this.persistence = persistence;
  }

  sessionStarted({ sessionId, flowType, correlationId }) {
    this.ws.emitGenerationSessionStart(
      {
        sessionId,
        flowType,
        timestamp: new Date().toISOString(),
      },
      { correlationId }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'SESSION_STARTED',
      message: `Session ${sessionId} of type ${flowType} started.`,
      details: { flowType, correlationId },
    });
  }

  sessionCompleted({ sessionId, correlationId }) {
    this.ws.emitGenerationSessionComplete(
      {
        sessionId,
        timestamp: new Date().toISOString(),
      },
      { correlationId }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'SESSION_COMPLETED',
      message: `Session ${sessionId} completed successfully.`,
      details: { correlationId },
    });
  }

  sessionFailed({ sessionId, error, correlationId }) {
    this.ws.emitError(
      {
        sessionId,
        message: error.message,
        errorReference: error.errorReference,
        timestamp: new Date().toISOString(),
      },
      { correlationId }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'SESSION_FAILED',
      message: `Session ${sessionId} failed: ${error.message}`,
      details: { error, correlationId },
    });
  }

  stepStarted({ sessionId, step, correlationId }) {
    this.ws.emitStepStarted(
        {
            sessionId,
            step,
            timestamp: new Date().toISOString(),
        },
        { correlationId }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'STEP_STARTED',
      message: `Step '${step}' started.`,
      details: { step, correlationId },
    });
  }

  stepCompleted({ sessionId, step, correlationId }) {
    this.ws.emitStepCompleted(
        {
            sessionId,
            step,
            timestamp: new Date().toISOString(),
        },
        { correlationId }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'STEP_COMPLETED',
      message: `Step '${step}' completed.`,
      details: { step, correlationId },
    });
  }

  batchStarted({ sessionId, batchERC, batchId, totalItems, entityType, operation, correlationId }) {
    const payload = {
        entityType,
        operation,
        ...resolvePhaseAndMode({ useBatch: true, phase: 'submit' }),
        batchId,
        batchERC,
        totalItems,
        sessionId,
      };

    this.ws.emitBatchStarted(payload, { correlationId });
    this.persistence.logWorkflowEvent({
        sessionId,
        batchId,
        status: 'BATCH_STARTED',
        message: `Batch ${batchId} (${entityType}/${operation}) started with ${totalItems} items.`,
        details: payload,
      });
  }

  batchProgress({ sessionId, batchERC, batchId, completedCount, totalItems, correlationId }) {
    if (totalItems > 0) {
        const progress = Math.max(0, Math.min(100, Math.round((completedCount / totalItems) * 100)));
        
        const payload = {
            batchId,
            batchERC,
            sessionId,
            completedCount,
            totalItems,
            progress,
        };

        this.ws.emitBatchProgress(payload, { correlationId });
        this.persistence.logWorkflowEvent({
            sessionId,
            batchId,
            status: 'BATCH_PROGRESS',
            message: `Batch ${batchId} progress: ${completedCount}/${totalItems} (${progress}%).`,
            details: payload,
          });
    }
  }

  batchCompleted({ sessionId, batchERC, batchId, successCount, failureCount, errors, entityType, operation, correlationId }) {
    const payload = {
        entityType,
        operation,
        ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
        batchId,
        batchERC,
        sessionId,
        successCount,
        failureCount,
        errors: failureCount > 0 ? errors.slice(0, 5) : [],
      };
    this.ws.emitBatchCompleted(payload, { correlationId });
    this.persistence.logWorkflowEvent({
        sessionId,
        batchId,
        status: 'BATCH_COMPLETED',
        message: `Batch ${batchId} completed. Success: ${successCount}, Failures: ${failureCount}.`,
        details: payload,
      });
  }

  batchFailed({ sessionId, batchERC, batchId, error, entityType, operation, correlationId }) {
    const payload = {
        entityType,
        operation,
        ...resolvePhaseAndMode({ useBatch: true, phase: 'error' }),
        batchId,
        batchERC,
        sessionId,
        successCount: 0,
        failureCount: 1,
        errors: [{ message: error.message }],
      };
    this.ws.emitBatchCompleted(payload, { correlationId });
    this.persistence.logWorkflowEvent({
        sessionId,
        batchId,
        status: 'BATCH_FAILED',
        message: `Batch ${batchId} failed: ${error.message}`,
        details: payload,
      });
  }

  postProcessingStarted({ sessionId, entityType, batchId, correlationId }) {
    const payload = {
        entityType,
        batchId,
        operation: `process-${entityType}`,
        ...resolvePhaseAndMode({ useBatch: false, phase: 'postprocess' }),
        sessionId,
      };
    this.ws.emitPostProcessingStarted(payload, { correlationId });
    this.persistence.logWorkflowEvent({
        sessionId,
        batchId,
        status: 'POST_PROCESSING_STARTED',
        message: `Post-processing for ${entityType} started.`,
        details: payload,
      });
  }

  postProcessingCompleted({ sessionId, entityType, batchId, processedCount, totalCount, correlationId }) {
    const payload = {
        entityType,
        batchId,
        operation: `process-${entityType}`,
        ...resolvePhaseAndMode({ useBatch: false, phase: 'postprocess' }),
        processedCount,
        totalCount,
        sessionId,
      };
    this.ws.emitPostProcessingCompleted(payload, { correlationId });
    this.persistence.logWorkflowEvent({
        sessionId,
        batchId,
        status: 'POST_PROCESSING_COMPLETED',
        message: `Post-processing for ${entityType} completed. Processed: ${processedCount}/${totalCount}.`,
        details: payload,
      });
  }

  emitError({ message, errorReference, correlationId, ...rest }) {
    const payload = {
        message,
        errorReference,
        correlationId,
        ...rest
    };
    this.ws.emitError(payload);
    this.persistence.logWorkflowEvent({
        sessionId: rest.sessionId,
        batchId: rest.batchId,
        status: 'ERROR',
        message: `Error: ${message}`,
        details: payload,
    });
  }
}

module.exports = ProgressService;
