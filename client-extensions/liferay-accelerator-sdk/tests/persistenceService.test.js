const PersistenceService = require('../src/services/persistenceService.cjs');

describe('PersistenceService', () => {
  let persistence;

  beforeEach(() => {
    // Use an in-memory database for testing
    persistence = new PersistenceService(null, ':memory:');
  });

  afterEach(() => {
    persistence.close();
  });

  it('should initialize the schema correctly', () => {
    // If we can insert a session, the schema is working
    const session = persistence.createSession({
      sessionId: 'test-session',
      flowType: 'products',
      status: 'STARTED',
      context: { foo: 'bar' },
      currentSteps: ['step1'],
    });

    expect(session.session_id).toBe('test-session');
    expect(session.status).toBe('STARTED');
    expect(session.context.foo).toBe('bar');
  });

  it('should retrieve a session by ID', () => {
    persistence.createSession({
      sessionId: 'test-session',
      flowType: 'products',
      status: 'STARTED',
    });

    const session = persistence.getSession('test-session');
    expect(session).not.toBeNull();
    expect(session.session_id).toBe('test-session');
  });

  it('should update session status', () => {
    persistence.createSession({
      sessionId: 'test-session',
      flowType: 'products',
      status: 'STARTED',
    });

    persistence.updateSessionStatus('test-session', 'COMPLETED');
    const session = persistence.getSession('test-session');
    expect(session.status).toBe('COMPLETED');
  });

  it('should create and retrieve batches for a session', () => {
    persistence.createSession({
      sessionId: 'test-session',
      flowType: 'products',
      status: 'STARTED',
    });

    persistence.createBatch({
      erc: 'batch-1',
      sessionId: 'test-session',
      stepKey: 'create-products',
      status: 'PREPARED',
      totalCount: 10,
    });

    const batches = persistence.getBatchesForSession('test-session');
    expect(batches).toHaveLength(1);
    expect(batches[0].erc).toBe('batch-1');
    expect(batches[0].total_count).toBe(10);
  });

  it('should update batch details', () => {
    persistence.createSession({
      sessionId: 'test-session',
      flowType: 'products',
      status: 'STARTED',
    });

    persistence.createBatch({
      erc: 'batch-1',
      sessionId: 'test-session',
      stepKey: 'create-products',
      status: 'PREPARED',
    });

    persistence.updateBatch('batch-1', {
      status: 'COMPLETED',
      processedCount: 5,
    });

    const batch = persistence.getBatch('batch-1');
    expect(batch.status).toBe('COMPLETED');
    expect(batch.processed_count).toBe(5);
  });

  it('should verify dependency readiness', async () => {
    const sessionId = 'test-session';
    persistence.createSession({
      sessionId,
      flowType: 'products',
      status: 'STARTED',
    });

    persistence.createBatch({
      erc: 'batch-1',
      sessionId,
      stepKey: 'step-1',
      status: 'COMPLETED',
    });

    const ready = await persistence.verifyDependencyReady(sessionId, 'step-1');
    expect(ready).toBe(true);

    persistence.createBatch({
      erc: 'batch-2',
      sessionId,
      stepKey: 'step-2',
      status: 'PREPARED',
    });

    const notReady = await persistence.verifyDependencyReady(
      sessionId,
      'step-2'
    );
    expect(notReady).toBe(false);
  });

  it('should log workflow events', () => {
    const sessionId = 'test-session';
    persistence.createSession({
      sessionId,
      flowType: 'products',
      status: 'STARTED',
    });

    persistence.logWorkflowEvent({
      sessionId,
      status: 'INFO',
      message: 'Testing event log',
      details: { key: 'value' },
    });

    const events = persistence.getEventsForSession(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe('Testing event log');
    expect(events[0].details.key).toBe('value');
  });

  it('should filter completed sessions to exclude deletion flows', () => {
    persistence.createSession({
      sessionId: 'gen-1',
      flowType: 'generate',
      status: 'COMPLETED',
    });
    persistence.createSession({
      sessionId: 'acc-1',
      flowType: 'accounts',
      status: 'COMPLETED',
    });
    persistence.createSession({
      sessionId: 'del-1',
      flowType: 'delete',
      status: 'COMPLETED',
    });

    const completed = persistence.getCompletedSessions();
    expect(completed).toHaveLength(2);
    expect(completed.some((s) => s.session_id === 'gen-1')).toBe(true);
    expect(completed.some((s) => s.session_id === 'acc-1')).toBe(true);
    expect(completed.some((s) => s.session_id === 'del-1')).toBe(false);
  });
});
