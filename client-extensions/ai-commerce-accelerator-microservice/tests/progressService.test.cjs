const ProgressService = require('../services/progressService.cjs');
const { WEB_SOCKET_EVENTS, WS_SCOPE } = require('../utils/constants.cjs');

describe('ProgressService', () => {
  let service;
  let mockWs;
  let mockLogger;
  let mockPersistence;

  beforeEach(() => {
    mockWs = {
      emitProgress: vi.fn(),
      emitGenerationSessionComplete: vi.fn(),
      emitError: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    };

    mockPersistence = {
      logWorkflowEvent: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ flow_type: 'generate' }),
    };

    service = new ProgressService({
      ws: mockWs,
      logger: mockLogger,
      persistence: mockPersistence,
    });
  });

  it('should construct correctly', () => {
    expect(service.ws).toBe(mockWs);
    expect(service.logger).toBe(mockLogger);
    expect(service.persistence).toBe(mockPersistence);
  });

  it('should handle sessionStarted correctly', () => {
    service.sessionStarted({
      sessionId: 'session-123',
      flowType: 'generate',
      correlationId: 'cid-123',
      totalSteps: 5,
      totals: { products: 10 },
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.STARTED,
        scope: WS_SCOPE.SESSION,
        details: { flowType: 'generate', totalSteps: 5 },
        totals: { products: 10 },
      }),
      { correlationId: 'cid-123' }
    );

    expect(mockPersistence.logWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        status: 'SESSION_STARTED',
      })
    );
  });

  it('should handle sessionCompleted correctly', async () => {
    await service.sessionCompleted({
      sessionId: 'session-123',
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.COMPLETED,
        scope: WS_SCOPE.SESSION,
      }),
      { correlationId: 'cid-123' }
    );

    expect(mockWs.emitGenerationSessionComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
      }),
      { correlationId: 'cid-123' }
    );

    expect(mockPersistence.logWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        status: 'SESSION_COMPLETED',
      })
    );
  });

  it('should handle sessionFailed correctly', async () => {
    const error = new Error('Test error');
    error.errorReference = 'REF-123';
    error.stack = 'stacktrace';

    await service.sessionFailed({
      sessionId: 'session-123',
      error,
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.FAILED,
        scope: WS_SCOPE.SESSION,
        error: 'Test error',
        errorStack: 'stacktrace',
        errorReference: 'REF-123',
      }),
      { correlationId: 'cid-123' }
    );

    expect(mockPersistence.logWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        status: 'SESSION_FAILED',
        message: 'Session session-123 failed: Test error',
      })
    );
  });

  it('should handle stepStarted correctly', () => {
    service.stepStarted({
      sessionId: 'session-123',
      step: 'Step 1',
      totalCount: 10,
      entityType: 'product',
      operation: 'generate',
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.STARTED,
        scope: WS_SCOPE.STEP,
        entityType: 'product',
        operation: 'generate',
        totalCount: 10,
      }),
      { correlationId: 'cid-123' }
    );

    expect(mockPersistence.logWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        status: 'STEP_STARTED',
        message: "Step 'Step 1' started.",
      })
    );
  });

  it('should handle stepProgress correctly', () => {
    service.stepProgress({
      sessionId: 'session-123',
      entityType: 'product',
      operation: 'generate',
      processedCount: 5,
      totalCount: 10,
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.PROGRESS,
        scope: WS_SCOPE.STEP,
        entityType: 'product',
        operation: 'generate',
        processedCount: 5,
        totalCount: 10,
      }),
      { correlationId: 'cid-123' }
    );
  });

  it('should handle stepCompleted correctly', () => {
    service.stepCompleted({
      sessionId: 'session-123',
      step: 'Step 1',
      entityType: 'product',
      operation: 'generate',
      totalCount: 10,
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.COMPLETED,
        scope: WS_SCOPE.STEP,
        entityType: 'product',
        operation: 'generate',
        totalCount: 10,
        processedCount: 10,
      }),
      { correlationId: 'cid-123' }
    );

    expect(mockPersistence.logWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        status: 'STEP_COMPLETED',
        message: "Step 'Step 1' completed.",
      })
    );
  });

  it('should handle stepFailed correctly', () => {
    service.stepFailed({
      sessionId: 'session-123',
      stepKey: 'step-key',
      entityType: 'product',
      error: { message: 'Step failed' },
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.FAILED,
        scope: WS_SCOPE.STEP,
        entityType: 'product',
        stepKey: 'step-key',
        error: 'Step failed',
      }),
      { correlationId: 'cid-123' }
    );

    expect(mockPersistence.logWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        status: 'STEP_FAILED',
        message: "Step 'step-key' failed: Step failed",
      })
    );
  });

  it('should handle batchStarted correctly', () => {
    service.batchStarted({
      sessionId: 'session-123',
      batchERC: 'erc-123',
      batchId: 'bid-123',
      totalItems: 5,
      entityType: 'product',
      operation: 'generate',
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.STARTED,
        scope: WS_SCOPE.BATCH,
        entityType: 'product',
        operation: 'generate',
        batchId: 'bid-123',
        batchERC: 'erc-123',
        totalCount: 5,
      }),
      { correlationId: 'cid-123' }
    );

    expect(mockPersistence.logWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        status: 'BATCH_STARTED',
      })
    );
  });

  it('should handle batchProgress correctly', () => {
    service.batchProgress({
      sessionId: 'session-123',
      batchERC: 'erc-123',
      batchId: 'bid-123',
      completedCount: 3,
      totalItems: 5,
      entityType: 'product',
      operation: 'generate',
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.PROGRESS,
        scope: WS_SCOPE.BATCH,
        processedCount: 3,
        totalCount: 5,
      }),
      { correlationId: 'cid-123' }
    );
  });

  it('should handle batchCompleted correctly', () => {
    service.batchCompleted({
      sessionId: 'session-123',
      batchERC: 'erc-123',
      batchId: 'bid-123',
      successCount: 4,
      failureCount: 1,
      errors: [{ message: 'Err' }],
      entityType: 'product',
      operation: 'generate',
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.COMPLETED,
        scope: WS_SCOPE.BATCH,
        details: expect.objectContaining({
          successCount: 4,
          failureCount: 1,
        }),
      }),
      { correlationId: 'cid-123' }
    );
  });

  it('should handle emitBatchItemsFailed correctly', () => {
    service.emitBatchItemsFailed({
      sessionId: 'session-123',
      batchERC: 'erc-123',
      batchId: 'bid-123',
      entityType: 'product',
      operation: 'generate',
      failedItems: [{ errorMessage: 'Fail item' }],
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.BATCH_ERROR_DETAILS,
        scope: WS_SCOPE.BATCH,
      }),
      { correlationId: 'cid-123' }
    );
  });

  it('should handle batchFailed correctly', () => {
    service.batchFailed({
      sessionId: 'session-123',
      batchERC: 'erc-123',
      batchId: 'bid-123',
      error: { message: 'Batch crash' },
      entityType: 'product',
      operation: 'generate',
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.FAILED,
        scope: WS_SCOPE.BATCH,
        error: 'Batch crash',
      }),
      { correlationId: 'cid-123' }
    );
  });

  it('should handle postProcessingStarted correctly', () => {
    service.postProcessingStarted({
      sessionId: 'session-123',
      entityType: 'product',
      batchId: 'bid-123',
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.STARTED,
        scope: WS_SCOPE.STEP,
      }),
      { correlationId: 'cid-123' }
    );
  });

  it('should handle postProcessingCompleted correctly', () => {
    service.postProcessingCompleted({
      sessionId: 'session-123',
      entityType: 'product',
      batchId: 'bid-123',
      processedCount: 10,
      totalCount: 10,
      correlationId: 'cid-123',
    });

    expect(mockWs.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        status: WEB_SOCKET_EVENTS.COMPLETED,
        scope: WS_SCOPE.STEP,
      }),
      { correlationId: 'cid-123' }
    );
  });

  it('should handle emitError correctly', () => {
    service.emitError({
      message: 'Global fail',
      errorReference: 'ERR-REF',
      errorStack: 'stack',
      correlationId: 'cid-123',
      sessionId: 'session-123',
    });

    expect(mockWs.emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        correlationId: 'cid-123',
        message: 'Global fail',
        status: WEB_SOCKET_EVENTS.FAILED,
      }),
      { correlationId: 'cid-123' }
    );
  });
});
