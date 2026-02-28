const { resolvePhaseAndMode } = require('../utils/misc.cjs');
const {
  WEB_SOCKET_EVENTS,
  WS_SCOPE,
  WS_OPERATION,
} = require('../utils/constants.cjs');

class ProgressService {
  constructor({ ws, logger, persistence }) {
    this.ws = ws;
    this.logger = logger;
    this.persistence = persistence;
  }

  sessionStarted({ sessionId, flowType, correlationId }) {
    const cid = correlationId;
    this.ws.emitProgress(
      {
        sessionId,
        correlationId: cid,
        status: WEB_SOCKET_EVENTS.STARTED,
        scope: WS_SCOPE.SESSION,
        details: { flowType },
      },
      { correlationId: cid }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'SESSION_STARTED',
      message: `Session ${sessionId} of type ${flowType} started.`,
      details: { flowType, correlationId: cid },
    });
  }

  sessionCompleted({ sessionId, correlationId }) {
    const cid = correlationId;
    this.ws.emitProgress(
      {
        sessionId,
        correlationId: cid,
        status: WEB_SOCKET_EVENTS.COMPLETED,
        scope: WS_SCOPE.SESSION,
      },
      { correlationId: cid }
    );
    // Legacy support for top-level completion signal
    this.ws.emitGenerationSessionComplete(
      {
        sessionId,
        correlationId: cid,
        timestamp: new Date().toISOString(),
      },
      { correlationId: cid }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'SESSION_COMPLETED',
      message: `Session ${sessionId} completed successfully.`,
      details: { correlationId: cid },
    });
  }

  sessionFailed({ sessionId, error, correlationId }) {
    const cid = correlationId;
    this.ws.emitProgress(
      {
        sessionId,
        correlationId: cid,
        status: WEB_SOCKET_EVENTS.FAILED,
        scope: WS_SCOPE.SESSION,
        error: error.message,
        errorReference: error.errorReference,
      },
      { correlationId: cid }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'SESSION_FAILED',
      message: `Session ${sessionId} failed: ${error.message}`,
      details: { error, correlationId: cid },
    });
  }

  stepStarted({
    sessionId,
    step,
    totalCount,
    entityType,
    operation,
    correlationId,
  }) {
    const cid = correlationId;
    this.ws.emitProgress(
      {
        sessionId,
        correlationId: cid,
        status: WEB_SOCKET_EVENTS.STARTED,
        scope: WS_SCOPE.STEP,
        entityType,
        operation,
        totalCount,
        message: `Step '${step}' started.`,
      },
      { correlationId: cid }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'STEP_STARTED',
      message: `Step '${step}' started.`,
      details: { step, correlationId: cid },
    });
  }

  stepProgress({
    sessionId,
    entityType,
    operation,
    processedCount,
    totalCount,
    correlationId,
  }) {
    const cid = correlationId;
    this.ws.emitProgress(
      {
        sessionId,
        correlationId: cid,
        status: WEB_SOCKET_EVENTS.PROGRESS,
        scope: WS_SCOPE.STEP,
        entityType,
        operation,
        processedCount,
        totalCount,
      },
      { correlationId: cid }
    );
  }

  stepCompleted({
    sessionId,
    step,
    entityType,
    operation,
    totalCount,
    correlationId,
  }) {
    const cid = correlationId;
    this.ws.emitProgress(
      {
        sessionId,
        correlationId: cid,
        status: WEB_SOCKET_EVENTS.COMPLETED,
        scope: WS_SCOPE.STEP,
        entityType,
        operation,
        totalCount,
        processedCount: totalCount,
        message: `Step '${step}' completed.`,
      },
      { correlationId: cid }
    );
    this.persistence.logWorkflowEvent({
      sessionId,
      status: 'STEP_COMPLETED',
      message: `Step '${step}' completed.`,
      details: { step, correlationId: cid },
    });
  }

  batchStarted({
    sessionId,
    batchERC,
    batchId,
    totalItems,
    entityType,
    operation,
    correlationId,
  }) {
    const cid = correlationId;
    const payload = {
      entityType,
      operation,
      ...resolvePhaseAndMode({ useBatch: true, phase: 'submit' }),
      batchId,
      batchERC,
      totalCount: totalItems,
      sessionId,
      correlationId: cid,
      status: WEB_SOCKET_EVENTS.STARTED,
      scope: WS_SCOPE.BATCH,
    };

    this.ws.emitProgress(payload, { correlationId: cid });
    this.persistence.logWorkflowEvent({
      sessionId,
      batchId,
      status: 'BATCH_STARTED',
      message: `Batch ${batchId} (${entityType}/${operation}) started with ${totalItems} items.`,
      details: payload,
    });
  }

  batchProgress({
    sessionId,
    batchERC,
    batchId,
    completedCount,
    totalItems,
    correlationId,
  }) {
    const cid = correlationId;
    if (totalItems >= 0) {
      const payload = {
        batchId,
        batchERC,
        sessionId,
        correlationId: cid,
        processedCount: completedCount,
        totalCount: totalItems,
        status: WEB_SOCKET_EVENTS.PROGRESS,
        scope: WS_SCOPE.BATCH,
      };

      this.ws.emitProgress(payload, { correlationId: cid });
      this.persistence.logWorkflowEvent({
        sessionId,
        batchId,
        status: 'BATCH_PROGRESS',
        message: `Batch ${batchId} progress: ${completedCount}/${totalItems}.`,
        details: payload,
      });
    }
  }

  batchCompleted({
    sessionId,
    batchERC,
    batchId,
    successCount,
    failureCount,
    errors,
    entityType,
    operation,
    correlationId,
  }) {
    const cid = correlationId;
    const payload = {
      entityType,
      operation,
      ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
      batchId,
      batchERC,
      sessionId,
      correlationId: cid,
      status: WEB_SOCKET_EVENTS.COMPLETED,
      scope: WS_SCOPE.BATCH,
      details: {
        successCount,
        failureCount,
        errors:
          failureCount > 0 && Array.isArray(errors) ? errors.slice(0, 5) : [],
      },
    };
    this.ws.emitProgress(payload, { correlationId: cid });
    this.persistence.logWorkflowEvent({
      sessionId,
      batchId,
      status: 'BATCH_COMPLETED',
      message: `Batch ${batchId} completed. Success: ${successCount}, Failures: ${failureCount}.`,
      details: payload,
    });
  }

  batchFailed({
    sessionId,
    batchERC,
    batchId,
    error,
    entityType,
    operation,
    correlationId,
  }) {
    const cid = correlationId;
    const payload = {
      entityType,
      operation,
      ...resolvePhaseAndMode({ useBatch: true, phase: 'error' }),
      batchId,
      batchERC,
      sessionId,
      correlationId: cid,
      status: WEB_SOCKET_EVENTS.FAILED,
      scope: WS_SCOPE.BATCH,
      error: error.message,
      details: {
        successCount: 0,
        failureCount: 1,
        errors: [{ message: error.message }],
      },
    };
    this.ws.emitProgress(payload, { correlationId: cid });
    this.persistence.logWorkflowEvent({
      sessionId,
      batchId,
      status: 'BATCH_FAILED',
      message: `Batch ${batchId} failed: ${error.message}`,
      details: payload,
    });
  }

  postProcessingStarted({ sessionId, entityType, batchId, correlationId }) {
    const operation = `process-${entityType}`;
    const payload = {
      entityType,
      batchId,
      operation,
      ...resolvePhaseAndMode({ useBatch: false, phase: 'postprocess' }),
      sessionId,
      correlationId,
      status: WEB_SOCKET_EVENTS.STARTED,
      scope: WS_SCOPE.STEP, // Post-processing is treated as a STEP in the new model
    };
    this.ws.emitProgress(payload, { correlationId });
    this.persistence.logWorkflowEvent({
      sessionId,
      batchId,
      status: 'POST_PROCESSING_STARTED',
      message: `Post-processing for ${entityType} started.`,
      details: payload,
    });
  }

  postProcessingCompleted({
    sessionId,
    entityType,
    batchId,
    processedCount,
    totalCount,
    correlationId,
  }) {
    const operation = `process-${entityType}`;
    const payload = {
      entityType,
      batchId,
      operation,
      ...resolvePhaseAndMode({ useBatch: false, phase: 'postprocess' }),
      processedCount,
      totalCount,
      sessionId,
      correlationId,
      status: WEB_SOCKET_EVENTS.COMPLETED,
      scope: WS_SCOPE.STEP,
    };
    this.ws.emitProgress(payload, { correlationId });
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
      sessionId: rest.sessionId,
      batchId: rest.batchId,
      correlationId,
      message,
      errorReference,
      status: WEB_SOCKET_EVENTS.FAILED,
      scope: rest.scope || WS_SCOPE.SESSION,
      ...rest,
    };
    this.ws.emitError(payload, { correlationId });
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
