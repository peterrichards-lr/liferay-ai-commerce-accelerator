const fs = require('fs');
const os = require('os');
const path = require('path');

const BaseGenerator = require('../generators/baseGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');
const workflowRoute = require('../routes/workflow.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const {
  deriveStepStates,
  planSessionResume,
} = require('../utils/resumePlan.cjs');

const { summariseSessionProgress } = workflowRoute;

const S = WORKFLOW_STEPS;

const silent = () => {};

/** Enough of a logger for the SDK's services, and nothing on the console. */
const quietLogger = {
  debug: silent,
  error: silent,
  info: silent,
  success: silent,
  trace: silent,
  warn: silent,
};

const batch = (stepKey, status, counts = {}) => ({
  step_key: stepKey,
  status,
  processed_count: counts.processed ?? 0,
  total_count: counts.total ?? 0,
  erc: counts.erc || `AICA-BATCH-${stepKey}-${status}`,
});

describe('Planning a resume', () => {
  const failed = { status: 'FAILED' };

  it('reads a step with no rows as neither complete nor failed', () => {
    // The engine calls that PENDING and runs it. Resume relies on exactly
    // that: it never has to list what still has to happen, only to stop
    // pretending the failed step already did.
    const states = deriveStepStates([batch(S.CREATE_PRODUCTS, 'SYNCHRONOUS')]);

    expect(states.has(S.CREATE_PRODUCTS)).toBe(true);
    expect(states.has(S.CREATE_ORDERS)).toBe(false);
  });

  it('resumes a failed session at the step that failed, keeping the rest', () => {
    const plan = planSessionResume({
      session: failed,
      batches: [
        batch(S.CREATE_PRODUCTS, 'COMPLETED', { processed: 22, total: 22 }),
        batch(S.LINK_PRODUCT_OPTIONS, 'FAILED'),
      ],
    });

    expect(plan.resumable).toBe(true);
    expect(plan.stepsToClear).toEqual([S.LINK_PRODUCT_OPTIONS]);
    expect(plan.completedSteps).toEqual([S.CREATE_PRODUCTS]);
  });

  it('clears the failed step and nothing else', () => {
    // The other steps' rows are what the progress bar is summed from. A resume
    // that cleared the session would empty the record of work Liferay did.
    const plan = planSessionResume({
      session: failed,
      batches: [
        batch(S.CREATE_PRODUCTS, 'COMPLETED', { processed: 22, total: 22 }),
        batch(S.CREATE_WAREHOUSES, 'COMPLETED', { processed: 5, total: 5 }),
        batch(S.LINK_PRODUCT_OPTIONS, 'FAILED'),
      ],
    });

    expect(plan.stepsToClear).toEqual([S.LINK_PRODUCT_OPTIONS]);
    expect(plan.stepsToClear).not.toContain(S.CREATE_PRODUCTS);
    expect(plan.stepsToClear).not.toContain(S.CREATE_WAREHOUSES);
  });

  it('resumes a session that failed before any step recorded a failure', () => {
    // Runs 1 and 2 of #895: the channel would not resolve, after five
    // warehouses had already been created. executeNextStep fails the session
    // from its own catch block without writing a batch row, so there is
    // nothing to clear - and a resume that demanded something to clear would
    // refuse the very runs the issue opens with.
    const plan = planSessionResume({
      session: failed,
      batches: [
        batch(S.CREATE_WAREHOUSES, 'COMPLETED', { processed: 5, total: 5 }),
      ],
    });

    expect(plan.resumable).toBe(true);
    expect(plan.stepsToClear).toEqual([]);
  });

  it('refuses a session that is not FAILED, and says which it is', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'STARTED']) {
      const plan = planSessionResume({ session: { status }, batches: [] });

      expect(plan.resumable).toBe(false);
      expect(plan.reason).toContain(status);
    }
  });

  it('refuses when there is no such session', () => {
    expect(planSessionResume({ session: null }).resumable).toBe(false);
  });

  it('refuses to re-enter a step that cannot be re-run, naming it', () => {
    // The whole point of the audit. This used the media steps, which were the
    // only two classified UNSAFE - #1040 gave them a deterministic ERC and an
    // existence check, so today no step in WORKFLOW_STEPS is unsafe and the
    // refusal has no real subject to exercise it.
    //
    // A step the table does not know is used instead, because `rerunSafetyOf`
    // defaults an unclassified step to UNSAFE. That is the condition worth
    // covering anyway: the guard has to hold for the next step somebody adds
    // and forgets to classify, which is exactly when nobody is looking.
    const unclassified = 'a-step-nobody-classified';

    const plan = planSessionResume({
      session: failed,
      batches: [
        batch(S.CREATE_PRODUCTS, 'COMPLETED', { processed: 22, total: 22 }),
        batch(unclassified, 'FAILED'),
      ],
    });

    expect(plan.resumable).toBe(false);
    expect(plan.reason).toContain(unclassified);
    expect(plan.unsafeSteps).toEqual([unclassified]);
  });

  it('refuses while a batch is still outstanding, rather than repeating it', () => {
    // PREPARED means submitted to Liferay with no callback yet. Clearing it
    // would abandon work that may still land; leaving it would stall the
    // advance on a step the engine waits on forever.
    const plan = planSessionResume({
      session: failed,
      batches: [
        batch(S.CREATE_ACCOUNTS, 'PREPARED', { total: 10 }),
        batch(S.LINK_PRODUCT_OPTIONS, 'FAILED'),
      ],
    });

    expect(plan.resumable).toBe(false);
    expect(plan.reason).toContain(S.CREATE_ACCOUNTS);
    expect(plan.runningSteps).toEqual([S.CREATE_ACCOUNTS]);
  });

  it('treats a BYPASSED step as finished, so a resume does not repeat it', () => {
    // A media step that failed records BYPASSED, which is terminal. That is
    // what keeps #895's unsafe pair out of a resume's path in practice, and it
    // is also the limit worth knowing: the media of a run that got that far is
    // #893's job, not this one's.
    const plan = planSessionResume({
      session: failed,
      batches: [
        batch(S.ATTACH_IMAGES, 'BYPASSED'),
        batch(S.CREATE_ORDERS, 'FAILED'),
      ],
    });

    expect(plan.resumable).toBe(true);
    expect(plan.completedSteps).toContain(S.ATTACH_IMAGES);
    expect(plan.stepsToClear).toEqual([S.CREATE_ORDERS]);
  });
});

describe('The persistence primitives a resume needs', () => {
  let persistence;
  let dbPath;

  const session = (sessionId) => ({
    sessionId,
    flowType: 'import',
    status: 'STARTED',
    currentSteps: [],
    correlationId: 'corr-1',
    context: { steps: [], options: {} },
  });

  beforeEach(async () => {
    dbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'aica-resume-db-')),
      'workflows.db'
    );
    persistence = new PersistenceService({ logger: quietLogger }, dbPath);
    await persistence.initPromise;
  });

  afterEach(async () => {
    await persistence.close();
    fs.rmSync(path.dirname(dbPath), { force: true, recursive: true });
  });

  it('removes only the failed rows of the named step', async () => {
    await persistence.createSession(session('s1'));
    await persistence.createBatch({
      erc: 'A',
      sessionId: 's1',
      stepKey: S.CREATE_PRODUCTS,
      status: 'COMPLETED',
      processedCount: 22,
      totalCount: 22,
    });
    await persistence.createBatch({
      erc: 'B',
      sessionId: 's1',
      stepKey: S.LINK_PRODUCT_OPTIONS,
      status: 'FAILED',
    });
    await persistence.createBatch({
      erc: 'C',
      sessionId: 's1',
      stepKey: S.LINK_PRODUCT_OPTIONS,
      status: 'SYNCHRONOUS',
    });

    const cleared = await persistence.clearFailedBatchesForStep(
      's1',
      S.LINK_PRODUCT_OPTIONS
    );

    const remaining = await persistence.getBatchesForSession('s1');

    expect(cleared).toBe(1);
    expect(remaining.map((row) => row.erc).sort()).toEqual(['A', 'C']);
  });

  it('leaves another failed step of the same session alone', async () => {
    // Scoped to one step, not to the session. Two branches of a parallel
    // subflow can both end FAILED, and a caller that has decided only one of
    // them may be re-entered - because the other is classified UNSAFE - must
    // get exactly that.
    await persistence.createSession(session('s1'));
    await persistence.createBatch({
      erc: 'LINK',
      sessionId: 's1',
      stepKey: S.LINK_PRODUCT_OPTIONS,
      status: 'FAILED',
    });
    await persistence.createBatch({
      erc: 'IMAGES',
      sessionId: 's1',
      stepKey: S.ATTACH_IMAGES,
      status: 'FAILED',
    });

    const cleared = await persistence.clearFailedBatchesForStep(
      's1',
      S.LINK_PRODUCT_OPTIONS
    );

    expect(cleared).toBe(1);
    expect(
      (await persistence.getBatchesForSession('s1')).map((row) => row.erc)
    ).toEqual(['IMAGES']);
  });

  it('leaves the rows of another session alone', async () => {
    await persistence.createSession(session('s1'));
    await persistence.createSession(session('s2'));
    await persistence.createBatch({
      erc: 'OTHER',
      sessionId: 's2',
      stepKey: S.LINK_PRODUCT_OPTIONS,
      status: 'FAILED',
    });

    await persistence.clearFailedBatchesForStep('s1', S.LINK_PRODUCT_OPTIONS);

    expect(await persistence.getBatchesForSession('s2')).toHaveLength(1);
  });

  it('evicts the caches, so the step does not read FAILED straight back', async () => {
    await persistence.createSession(session('s1'));
    await persistence.createBatch({
      erc: 'B',
      sessionId: 's1',
      stepKey: S.LINK_PRODUCT_OPTIONS,
      status: 'FAILED',
    });

    // Both reads populate a cache, and both are what the engine consults when
    // it decides a step's state.
    await persistence.getBatchesForSession('s1');
    await persistence.getBatch('B');

    await persistence.clearFailedBatchesForStep('s1', S.LINK_PRODUCT_OPTIONS);

    expect(await persistence.getBatchesForSession('s1')).toEqual([]);
    expect(await persistence.getBatch('B')).toBeNull();
  });

  it('revives a failed session and drops the error it was carrying', async () => {
    await persistence.createSession(session('s1'));
    await persistence.tryFailSession('s1', 'channel unresolvable', 'ERR-1');

    expect(await persistence.tryReviveSession('s1')).toBe(true);

    const revived = await persistence.getSession('s1');

    expect(revived.status).toBe('STARTED');
    expect(revived.error_message).toBeNull();
    expect(revived.errorReferenceCode).toBeNull();
  });

  it('revives nothing that is not failed', async () => {
    await persistence.createSession(session('s1'));

    // STARTED: already being advanced. Reviving it would race the orchestrator.
    expect(await persistence.tryReviveSession('s1')).toBe(false);

    await persistence.tryFinalizeSession('s1');

    // COMPLETED: there is nothing to resume, and moving it back would make a
    // finished run look unfinished on every surface that reads the status.
    expect(await persistence.tryReviveSession('s1')).toBe(false);
    expect((await persistence.getSession('s1')).status).toBe('COMPLETED');
  });

  it('keeps the session context across the revive, SQLite round trip and all', async () => {
    const withContext = session('s1');
    withContext.context = {
      options: { productCount: 22 },
      resolvedCatalogId: 61432,
      steps: [{ name: S.CREATE_PRODUCTS, type: 'sync' }],
    };

    await persistence.createSession(withContext);
    await persistence.updateSessionContext('s1', { resolvedChannelId: 71001 });
    await persistence.tryFailSession('s1', 'boom');
    await persistence.tryReviveSession('s1');

    const revived = await persistence.getSession('s1');

    // The ids the earlier steps resolved are the reason resuming beats
    // restarting. updateSessionContext evicts the cache, so this is genuinely
    // re-parsed out of the database rather than handed back from memory.
    expect(revived.context.resolvedCatalogId).toBe(61432);
    expect(revived.context.resolvedChannelId).toBe(71001);
    expect(revived.context.steps).toHaveLength(1);
  });
});

/**
 * The test that has to be right for any of this to mean anything.
 *
 * Everything above asserts on a plan. This drives the real workflow engine -
 * the SDK's `executeNextStep`, over a real SQLite database - across a failure
 * and a resume, and counts how many times each step's handler was entered. A
 * resume that skipped nothing would pass every other assertion in this file.
 */
describe('Resuming a run that failed halfway', () => {
  let persistence;
  let dbPath;
  let generator;
  let entered;
  let failNext;

  const STEPS = [
    { name: S.CREATE_WAREHOUSES, type: 'sync' },
    { name: S.CREATE_PRODUCTS, type: 'sync' },
    { name: S.LINK_PRODUCT_OPTIONS, type: 'sync' },
  ];

  class ScriptedGenerator extends BaseGenerator {
    constructor(ctx) {
      super(ctx);

      const run = (stepKey, processed, total) => async (sessionId) => {
        entered.push(stepKey);

        if (failNext.has(stepKey)) {
          failNext.delete(stepKey);
          await this.persistence.createBatch({
            erc: `AICA-BATCH-${stepKey}-fail`,
            sessionId,
            stepKey,
            status: 'FAILED',
            totalCount: total,
          });
          throw new Error(`${stepKey} refused`);
        }

        await this.completeSyncStep(
          sessionId,
          stepKey,
          'SYNCHRONOUS',
          processed,
          total
        );
      };

      this.steps = {
        [S.CREATE_WAREHOUSES]: run(S.CREATE_WAREHOUSES, 5, 5),
        [S.CREATE_PRODUCTS]: run(S.CREATE_PRODUCTS, 22, 22),
        [S.LINK_PRODUCT_OPTIONS]: run(S.LINK_PRODUCT_OPTIONS, 22, 22),
      };
    }
  }

  const startSession = async (sessionId) => {
    await persistence.createSession({
      sessionId,
      flowType: 'import',
      status: 'STARTED',
      currentSteps: [],
      correlationId: 'corr-1',
      context: {
        config: {},
        options: {
          productCount: 22,
          warehouseCount: 5,
          createWarehouses: true,
        },
        steps: STEPS,
      },
    });
  };

  const resume = async (sessionId) => {
    const session = await persistence.getSession(sessionId);
    const batches = await persistence.getBatchesForSession(sessionId);
    const plan = planSessionResume({ session, batches });

    expect(plan.resumable).toBe(true);

    for (const stepKey of plan.stepsToClear) {
      await persistence.clearFailedBatchesForStep(sessionId, stepKey);
    }

    await persistence.tryReviveSession(sessionId);
    await generator.executeNextStep(sessionId);

    return plan;
  };

  const progressOf = async (sessionId) => {
    const session = await persistence.getSession(sessionId);

    return summariseSessionProgress({
      batches: await persistence.getBatchesForSession(sessionId),
      options: session.context.options,
    });
  };

  beforeEach(async () => {
    entered = [];
    failNext = new Set();
    dbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'aica-resume-run-')),
      'workflows.db'
    );
    persistence = new PersistenceService({ logger: quietLogger }, dbPath);
    await persistence.initPromise;

    generator = new ScriptedGenerator({
      batchCallback: { _checkSessionCompletion: vi.fn() },
      logger: quietLogger,
      persistence,
      progress: {
        sessionCompleted: vi.fn(),
        sessionFailed: vi.fn(),
        stepCompleted: vi.fn(),
        stepStarted: vi.fn(),
      },
    });
  });

  afterEach(async () => {
    await persistence.close();
    fs.rmSync(path.dirname(dbPath), { force: true, recursive: true });
  });

  it('re-enters the failed step and re-enters nothing before it', async () => {
    failNext.add(S.LINK_PRODUCT_OPTIONS);

    await startSession('s1');
    await generator.executeNextStep('s1');

    expect(entered).toEqual([
      S.CREATE_WAREHOUSES,
      S.CREATE_PRODUCTS,
      S.LINK_PRODUCT_OPTIONS,
    ]);
    expect((await persistence.getSession('s1')).status).toBe('FAILED');

    entered = [];
    await resume('s1');

    // The assertion the whole issue turns on: the warehouses and the products
    // are not created a second time. Every run in #895's table did exactly
    // that, and by run 4 the repetition was itself the failure.
    expect(entered).toEqual([S.LINK_PRODUCT_OPTIONS]);
    expect((await persistence.getSession('s1')).status).toBe('COMPLETED');
  });

  it('reports which steps it skipped, and they are the ones that ran', async () => {
    failNext.add(S.LINK_PRODUCT_OPTIONS);

    await startSession('s1');
    await generator.executeNextStep('s1');

    const plan = await resume('s1');

    expect(plan.completedSteps.sort()).toEqual(
      [S.CREATE_PRODUCTS, S.CREATE_WAREHOUSES].sort()
    );
  });

  it('leaves the same progress behind as a run that never failed', async () => {
    // #1011's family of defect, on the resume path: a rehydrated total that
    // double-counts or under-counts. It cannot here, because the completed
    // steps keep the rows their share was summed from and the failed step's
    // rows are replaced rather than added to.
    await startSession('clean');
    await generator.executeNextStep('clean');

    failNext.add(S.LINK_PRODUCT_OPTIONS);
    await startSession('resumed');
    await generator.executeNextStep('resumed');
    await resume('resumed');

    expect(await progressOf('resumed')).toEqual(await progressOf('clean'));
  });

  it('carries the failed attempt in the totals until the row is cleared', async () => {
    // The control for the equality above. The failed attempt's row already
    // claims the step's whole total, so two rows for one step would report the
    // work twice - which is why the clear is scoped to the failed step rather
    // than skipped as harmless.
    failNext.add(S.CREATE_PRODUCTS);

    await startSession('s1');
    await generator.executeNextStep('s1');

    expect((await progressOf('s1')).products).toEqual({
      completed: 0,
      total: 22,
    });
  });

  it('does not re-enter the failed step if its rows are left in place', async () => {
    // The control for "re-enters the failed step". A revive on its own is not
    // a resume: the engine reads the step's state off its batch rows, so a
    // surviving FAILED row sends the session straight back to FAILED without
    // the handler being entered at all. Clearing is what makes the difference,
    // and this is what proves the earlier assertion is not passing for some
    // other reason.
    failNext.add(S.CREATE_PRODUCTS);

    await startSession('s1');
    await generator.executeNextStep('s1');

    entered = [];
    await persistence.tryReviveSession('s1');
    await generator.executeNextStep('s1');

    expect(entered).toEqual([]);
    expect((await persistence.getSession('s1')).status).toBe('FAILED');
  });
});

describe('The resume route', () => {
  let handlers;
  let persistenceService;
  let batchCallbackService;
  let res;

  const respond = () => {
    const sent = { body: null, status: 200 };

    return {
      json: vi.fn((body) => {
        sent.body = body;
        return sent;
      }),
      status: vi.fn((code) => {
        sent.status = code;
        return res;
      }),
      sent,
    };
  };

  beforeEach(() => {
    handlers = {};
    res = respond();

    persistenceService = {
      clearFailedBatchesForStep: vi.fn().mockResolvedValue(1),
      getAllSessions: vi.fn().mockResolvedValue([]),
      getBatchesForSession: vi.fn().mockResolvedValue([]),
      getSession: vi.fn(),
      tryReviveSession: vi.fn().mockResolvedValue(true),
    };

    batchCallbackService = { _checkSessionCompletion: vi.fn() };

    const app = {
      delete: vi.fn(),
      get: vi.fn(),
      post: vi.fn((routePath, handler) => {
        handlers[routePath] = handler;
      }),
    };

    workflowRoute(app, {
      batchCallbackService,
      logger: {
        error: vi.fn(),
        errorWithStack: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
      persistenceService,
      progressService: { sessionStarted: vi.fn() },
    });
  });

  const callResume = () =>
    handlers[INTERNAL_API_PATHS.WORKFLOW_RESUME](
      { correlationId: 'corr-1', params: { sessionId: 's1' } },
      res
    );

  it('clears the failed step, revives the session and advances it', async () => {
    persistenceService.getSession.mockResolvedValue({
      status: 'FAILED',
      flow_type: 'import',
      correlationId: 'corr-1',
    });
    persistenceService.getBatchesForSession.mockResolvedValue([
      batch(S.CREATE_PRODUCTS, 'COMPLETED', { processed: 22, total: 22 }),
      batch(S.LINK_PRODUCT_OPTIONS, 'FAILED'),
    ]);

    await callResume();

    expect(persistenceService.clearFailedBatchesForStep).toHaveBeenCalledWith(
      's1',
      S.LINK_PRODUCT_OPTIONS
    );
    expect(persistenceService.tryReviveSession).toHaveBeenCalledWith('s1');
    expect(batchCallbackService._checkSessionCompletion).toHaveBeenCalled();
    expect(res.sent.body).toMatchObject({
      success: true,
      resumedAt: [S.LINK_PRODUCT_OPTIONS],
      skippedSteps: [S.CREATE_PRODUCTS],
    });
  });

  it('clears before it revives, so the advance cannot read the old failure', async () => {
    const order = [];

    persistenceService.getSession.mockResolvedValue({
      status: 'FAILED',
      flow_type: 'import',
      correlationId: 'corr-1',
    });
    persistenceService.getBatchesForSession.mockResolvedValue([
      batch(S.LINK_PRODUCT_OPTIONS, 'FAILED'),
    ]);
    persistenceService.clearFailedBatchesForStep.mockImplementation(
      async () => {
        order.push('clear');
        return 1;
      }
    );
    persistenceService.tryReviveSession.mockImplementation(async () => {
      order.push('revive');
      return true;
    });

    await callResume();

    expect(order).toEqual(['clear', 'revive']);
  });

  it('refuses with the reason rather than resuming into a duplicate', async () => {
    // Was the media steps; #1040 made those converge, so an unclassified step
    // stands in - `rerunSafetyOf` defaults one to UNSAFE, which is the same
    // path and the one that has to hold for a step somebody forgets to
    // classify.
    const unclassified = 'a-step-nobody-classified';

    persistenceService.getSession.mockResolvedValue({ status: 'FAILED' });
    persistenceService.getBatchesForSession.mockResolvedValue([
      batch(unclassified, 'FAILED'),
    ]);

    await callResume();

    expect(res.sent.status).toBe(409);
    expect(res.sent.body.error).toContain(unclassified);
    expect(persistenceService.clearFailedBatchesForStep).not.toHaveBeenCalled();
    expect(persistenceService.tryReviveSession).not.toHaveBeenCalled();
    expect(batchCallbackService._checkSessionCompletion).not.toHaveBeenCalled();
  });

  it('answers 404 for a session that does not exist', async () => {
    persistenceService.getSession.mockResolvedValue(null);

    await callResume();

    expect(res.sent.status).toBe(404);
  });
});
