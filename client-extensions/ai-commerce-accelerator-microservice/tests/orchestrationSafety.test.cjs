const BaseGenerator = require('../generators/baseGenerator.cjs');

// Mock infrastructure
const mockPersistence = {
  getSession: vi.fn(),
  getBatchesForSession: vi.fn(),
  updateSessionCurrentSteps: vi.fn(),
  verifyDependencyReady: vi.fn().mockResolvedValue(true),
  createBatch: vi.fn(),
};

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockProgress = {
  stepStarted: vi.fn(),
  stepCompleted: vi.fn(),
  sessionFailed: vi.fn(),
};

// Create a concrete subclass for testing
class TestGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);
    this.steps = {
      'valid-step': vi.fn().mockResolvedValue(true),
    };
  }
}

describe('Orchestration Safety (Ghost Step Protection)', () => {
  let generator;
  const ctx = {
    persistence: mockPersistence,
    logger: mockLogger,
    progress: mockProgress,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new TestGenerator(ctx);
  });

  it('should throw a FATAL ERROR if a step handler is missing', async () => {
    mockPersistence.getSession.mockResolvedValue({
      sessionId: 'SESS-1',
      flow_type: 'generate',
      context: {
        steps: ['missing-handler-step'],
      },
    });

    // We expect it to throw because 'missing-handler-step' is not in this.steps
    await expect(
      generator.executeStep('SESS-1', 'missing-handler-step')
    ).rejects.toThrow(
      /FATAL: No handler found for workflow step 'missing-handler-step'/
    );
  });

  it('should allow structural steps (parallel/sequence) without handlers', async () => {
    mockPersistence.getSession.mockResolvedValue({
      sessionId: 'SESS-1',
      flow_type: 'generate',
      context: {
        steps: [{ name: 'parallel-block', type: 'parallel', steps: [] }],
      },
    });

    // Should NOT throw for parallel/sequence as they are orchestrated differently
    await expect(
      generator.executeStep('SESS-1', 'parallel-block')
    ).resolves.not.toThrow();
  });

  it('should correctly mark a synchronous step as complete via completeSyncStep', async () => {
    mockPersistence.getSession.mockResolvedValue({
      sessionId: 'SESS-1',
      correlationId: 'CID-1',
      context: { steps: [] },
    });

    // Mock the executeNextStep to prevent recursive complexity in unit test
    const nextStepSpy = vi
      .spyOn(generator, 'executeNextStep')
      .mockResolvedValue(true);

    await generator.completeSyncStep('SESS-1', 'test-sync-step');

    // Verify batch creation in persistence
    expect(mockPersistence.createBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        stepKey: 'test-sync-step',
        status: 'SYNCHRONOUS',
      })
    );

    // Verify orchestration trigger
    expect(nextStepSpy).toHaveBeenCalled();
  });
});
