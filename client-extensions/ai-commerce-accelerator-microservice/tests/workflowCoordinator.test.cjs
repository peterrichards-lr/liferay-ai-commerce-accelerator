const WorkflowCoordinator = require('../generators/workflowCoordinator.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const AccountGenerator = require('../generators/accountGenerator.cjs');

describe('WorkflowCoordinator', () => {
  let coordinator;
  let mockCtx;
  let productGen;
  let accountGen;

  beforeEach(() => {
    mockCtx = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      persistence: {
        getSession: vi.fn(),
      },
      progress: {
        stepStarted: vi.fn(),
        stepCompleted: vi.fn(),
      },
    };

    coordinator = new WorkflowCoordinator(mockCtx);
    productGen = new ProductGenerator(mockCtx);
    accountGen = new AccountGenerator(mockCtx);

    // Mock steps to avoid complex initialization
    productGen.steps = { 'prod-step': vi.fn() };
    accountGen.steps = { 'acc-step': vi.fn() };

    coordinator.registerGenerator('product', productGen);
    coordinator.registerGenerator('account', accountGen);
  });

  it('should delegate step to correct generator', async () => {
    const sessionId = 'SESS-1';
    const session = {
      session_id: sessionId,
      context: { steps: [{ name: 'acc-step' }] },
    };
    mockCtx.persistence.getSession.mockResolvedValue(session);

    await coordinator.executeStep(sessionId, 'acc-step');

    expect(accountGen.steps['acc-step']).toHaveBeenCalled();
    expect(productGen.steps['prod-step']).not.toHaveBeenCalled();
  });

  it('should throw a FATAL ERROR if no handler found in any generator', async () => {
    const sessionId = 'SESS-1';
    const session = {
      session_id: sessionId,
      flow_type: 'generate',
      context: { steps: [{ name: 'unknown-step' }] },
    };
    mockCtx.persistence.getSession.mockResolvedValue(session);

    await expect(
      coordinator.executeStep(sessionId, 'unknown-step')
    ).rejects.toThrow(
      /FATAL: No handler found for workflow step 'unknown-step'/
    );
  });
});
