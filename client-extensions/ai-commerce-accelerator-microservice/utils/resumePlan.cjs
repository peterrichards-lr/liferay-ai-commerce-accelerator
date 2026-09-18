const { isSafeToRerun, rerunReasonFor } = require('./stepIdempotency.cjs');

/**
 * The batch statuses the workflow engine treats as final.
 *
 * Mirrors `isTerminal` in the SDK's `baseGenerator.cjs:537`. BLOCKED is in the
 * list: the step will not be attempted again, so the run advances past it
 * (#172).
 */
const TERMINAL_BATCH_STATUSES = [
  'COMPLETED',
  'FAILED',
  'BYPASSED',
  'SYNCHRONOUS',
  'BLOCKED',
];

const STEP_STATE = {
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  COMPLETE: 'COMPLETE',
  RUNNING: 'RUNNING',
};

/**
 * What the engine will make of each step's rows when it is next advanced.
 *
 * This mirrors the per-key half of `executeNextStep`'s state derivation
 * (`baseGenerator.cjs:545-565`) and deliberately stops there: the structural
 * half, which folds a sequence or a parallel into a single state, is the
 * engine's own business and resume has no use for it. A step with no rows at
 * all is absent from the result, which is how the engine reads PENDING - and
 * PENDING is precisely the state a cleared step has to be returned to before
 * it will run again.
 */
function deriveStepStates(batches = []) {
  const states = new Map();
  const stepKeys = [...new Set(batches.map((batch) => batch.step_key))];

  for (const key of stepKeys) {
    const stepBatches = batches.filter((batch) => batch.step_key === key);

    if (stepBatches.some((batch) => batch.status === 'FAILED')) {
      states.set(key, STEP_STATE.FAILED);
    } else if (stepBatches.some((batch) => batch.status === 'BLOCKED')) {
      states.set(key, STEP_STATE.BLOCKED);
    } else if (
      stepBatches.every((batch) =>
        TERMINAL_BATCH_STATUSES.includes(batch.status)
      )
    ) {
      states.set(key, STEP_STATE.COMPLETE);
    } else {
      states.set(key, STEP_STATE.RUNNING);
    }
  }

  return states;
}

const refusal = (reason, extra = {}) => ({
  blockedSteps: [],
  completedSteps: [],
  failedSteps: [],
  resumable: false,
  runningSteps: [],
  stepsToClear: [],
  unsafeSteps: [],
  ...extra,
  reason,
});

/**
 * Whether a failed session can be re-entered, and what has to be cleared first.
 *
 * Resume owns exactly one decision: may the engine be pointed at this session
 * again. Everything after that is the engine's - a step whose rows say COMPLETE
 * is skipped by `executeNextStep` itself, using the same code a first run uses,
 * which is what keeps a resumed run's progress meaning the same thing as a
 * fresh one's. Nothing is recomputed and nothing is rehydrated, because nothing
 * is thrown away except the failed step's own rows.
 *
 * It refuses in three cases, and says which:
 *
 *   1. The session is not FAILED. A COMPLETED or CANCELLED session has nothing
 *      to resume, and a running one is already being advanced.
 *   2. A step that failed is classified UNSAFE by `stepIdempotency.cjs`.
 *      Re-running it would duplicate rather than continue, and an operator who
 *      believes they are recovering while they are duplicating is worse off
 *      than one who restarted. #895's run 4 is that failure exactly.
 *   3. A step is RUNNING - it holds rows that are neither terminal nor absent,
 *      which is a batch submitted to Liferay whose callback never arrived.
 *      Clearing those rows would abandon work that may still land; leaving them
 *      would stall the advance on a step the engine will wait on forever.
 *      Reconciling them against Liferay's import tasks is what
 *      `recoverOrphanedSessions` does for non-terminal sessions, and it
 *      explicitly excludes FAILED ones.
 *
 * A failed session with no failed step at all is resumable with nothing to
 * clear. That is not an edge case: `executeNextStep` fails a session from its
 * own catch block (`baseGenerator.cjs:818`) without writing a batch row, which
 * is what runs 1 and 2 of #895 looked like - a channel that would not resolve,
 * after five warehouses had already been created.
 */
function planSessionResume({ session, batches = [] } = {}) {
  if (!session) {
    return refusal('There is no session with that id.');
  }

  const status = session.status;

  if (status !== 'FAILED') {
    return refusal(
      `Only a FAILED session can be resumed, and this one is ${status}.`
    );
  }

  const states = deriveStepStates(batches);
  const stepsIn = (state) =>
    [...states].filter(([, value]) => value === state).map(([key]) => key);

  const completedSteps = stepsIn(STEP_STATE.COMPLETE);
  const blockedSteps = stepsIn(STEP_STATE.BLOCKED);
  const failedSteps = stepsIn(STEP_STATE.FAILED);
  const runningSteps = stepsIn(STEP_STATE.RUNNING);

  const found = { blockedSteps, completedSteps, failedSteps, runningSteps };

  if (runningSteps.length > 0) {
    return refusal(
      `${runningSteps.join(', ')} still ${
        runningSteps.length === 1 ? 'holds a batch' : 'hold batches'
      } Liferay never reported on, so this session cannot be resumed without abandoning or repeating that work.`,
      { ...found, unsafeSteps: [] }
    );
  }

  const unsafeSteps = failedSteps.filter((step) => !isSafeToRerun(step));

  if (unsafeSteps.length > 0) {
    const named = unsafeSteps
      .map((step) => `${step} (${rerunReasonFor(step)})`)
      .join('; ');

    return refusal(
      `${named}. Running it again would duplicate rather than continue, so this session cannot be resumed past it.`,
      { ...found, unsafeSteps }
    );
  }

  return {
    ...found,
    reason: null,
    resumable: true,
    // The failed steps and only those. A step with no rows is already PENDING
    // and a step that completed keeps its rows, which is what its share of the
    // progress bar is made of.
    stepsToClear: failedSteps,
    unsafeSteps: [],
  };
}

module.exports = {
  STEP_STATE,
  TERMINAL_BATCH_STATUSES,
  deriveStepStates,
  planSessionResume,
};
