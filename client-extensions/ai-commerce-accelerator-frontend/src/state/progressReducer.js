/**
 * A bar has three numbers, and they answer three different questions.
 *
 *   - `requested` is what the operator asked for. It is seeded when a run
 *     starts and nothing the run reports may lower it.
 *   - `total` is the largest amount known to be in play. It starts at
 *     `requested` and only grows, because every later number arrives from the
 *     run itself: ask for 50 products, have the AI deliver 16, and a total
 *     taken from the steps that follow drops to 16 and reads 100% (#756).
 *   - `completed` is what actually happened, and `isDone` is whether the step
 *     finished. They are independent: a step can be finished and short, which
 *     is the state worth showing and the one the reducer used to overwrite
 *     (#761).
 */
const emptyEntity = () => ({
  total: 0,
  requested: 0,
  completed: 0,
  errors: [],
  batches: {},
  isDone: false,
});

const entityState = (state, entity) => state[entity] || emptyEntity();

const seededEntity = (cur, total) => ({
  ...cur,
  total,
  requested: total,
  completed: 0,
  errors: [],
  batches: {},
  isDone: false,
});

/**
 * A total may rise above the request and may never fall - not below the
 * request, and not below a figure already established.
 *
 * `cur.total` was left out of the maximum, so a later, smaller report lowered
 * it whenever `requested` was 0. That is every delete: nothing is requested,
 * so discovery's census is the only floor there is, and a step reporting a
 * narrower figure afterwards took the denominator with it. A delete that
 * removed 10 accounts read `10 / 2` (#786).
 */
const withRequestFloor = (cur, ...totals) =>
  Math.max(cur.requested || 0, cur.total || 0, ...totals.map((t) => t || 0));

/** What the step's own batch rows say happened - proof of work performed. */
const sumBatches = (batches, field) =>
  Object.values(batches || {}).reduce((sum, b) => sum + (b[field] || 0), 0);

export const initialProgress = {
  activeSessionId: null,
  activeFlowType: null, // generate, delete, etc.
  workflowStatus: 'idle', // idle, running, completed, failed
  startTime: null,
  lastUpdateTime: null,
  endTime: null,
  totalSteps: 0,
  completedSteps: 0,
  products: emptyEntity(),
  // Seeded here rather than conjured by the first batch that mentions them, so
  // a bar that never receives an event reads 0 rather than not existing (#752).
  skus: emptyEntity(),
  inventory: emptyEntity(),
  accounts: emptyEntity(),
  addresses: emptyEntity(),
  orders: emptyEntity(),
  images: { ...emptyEntity(), expected: 0 },
  pdfs: { ...emptyEntity(), expected: 0 },
  warehouses: emptyEntity(),
  specifications: emptyEntity(),
  options: emptyEntity(),
  priceLists: emptyEntity(),
  promotions: emptyEntity(),
};

/**
 * One key per batch, whatever shape its id arrives in.
 *
 * Liferay's batch id reaches us as both `536` and `536.0` - the submit records
 * one form and the callback the other - so keying on the raw value filed a
 * single batch under two entries and counted its items twice. It went unseen
 * while a completed step forced its bar to the total: the doubling was
 * clamped away and read as a tidy 50/50. With the bar reporting what actually
 * happened it surfaced as 70 of 50 (#776).
 *
 * A numeric id is canonicalised through Number, so 536 and '536.0' agree.
 * Anything else - the 'simulated-batch-...' ids, an ERC - is its own key
 * unchanged.
 */
function batchKey(batchId) {
  // Only a value that is already a number or a numeric string canonicalises.
  // Number(null) is 0 and Number('') is 0, so a missing id would otherwise
  // collide with batch zero.
  const canBeNumeric =
    typeof batchId === 'number' ||
    (typeof batchId === 'string' && batchId.trim() !== '');
  const asNumber = canBeNumeric ? Number(batchId) : NaN;

  return Number.isFinite(asNumber) ? String(asNumber) : String(batchId);
}

export function progressReducer(state, action) {
  const now = Date.now();

  switch (action.type) {
    case 'RESET':
      return initialProgress;

    case 'RESET_ALL': {
      const next = { ...initialProgress, lastUpdateTime: now };
      if (action.totals) {
        Object.entries(action.totals).forEach(([entity, total]) => {
          // A replacement rather than an assignment into next[entity]:
          // spreading initialProgress copies references to its entity objects,
          // so writing through one would leave this run's total sitting in the
          // module constant for the next run to inherit.
          if (next[entity]) next[entity] = seededEntity(next[entity], total);
        });
      }
      return next;
    }

    case 'MERGE':
      return { ...state, ...action.payload, lastUpdateTime: now };

    case 'APPLY_UPDATER':
      return { ...action.updater(state), lastUpdateTime: now };

    case 'SET_ACTIVE_SESSION': {
      const isNewSession =
        action.sessionId && action.sessionId !== state.activeSessionId;
      const nextState = {
        ...state,
        activeSessionId: action.sessionId,
        activeFlowType:
          action.flowType || (action.sessionId ? state.activeFlowType : null),
        workflowStatus: action.sessionId ? 'running' : state.workflowStatus,
        startTime: isNewSession ? now : state.startTime,
        lastUpdateTime: now,
        endTime: action.sessionId ? null : state.endTime,
      };

      if (isNewSession && action.totals) {
        Object.entries(action.totals).forEach(([entity, total]) => {
          if (nextState[entity]) {
            nextState[entity] = seededEntity(nextState[entity], total);
          }
        });
      }
      return nextState;
    }

    case 'SET_WORKFLOW_STATUS': {
      const isFinished = ['completed', 'failed'].includes(action.status);
      return {
        ...state,
        workflowStatus: action.status,
        lastUpdateTime: now,
        endTime: isFinished ? now : state.endTime,
      };
    }

    case 'SET_TOTAL_STEPS': {
      return { ...state, totalSteps: action.total, lastUpdateTime: now };
    }

    case 'INCREMENT_STEPS': {
      return {
        ...state,
        completedSteps: (state.completedSteps || 0) + 1,
        lastUpdateTime: now,
      };
    }

    case 'HYDRATE_STEPS': {
      return {
        ...state,
        completedSteps: action.completed,
        lastUpdateTime: now,
      };
    }

    case 'SET_TOTAL': {
      const { entity, total } = action;
      const cur = entityState(state, entity);
      return {
        ...state,
        [entity]: { ...cur, total: withRequestFloor(cur, total) },
        lastUpdateTime: now,
      };
    }

    case 'SET_TOTALS': {
      const next = { ...state, lastUpdateTime: now };
      Object.entries(action.totals).forEach(([entity, total]) => {
        const cur = entityState(next, entity);
        next[entity] = { ...cur, total: withRequestFloor(cur, total) };
      });
      return next;
    }

    case 'SET_EXPECTED_VALUES': {
      const next = { ...state, lastUpdateTime: now };
      Object.entries(action.values).forEach(([entity, expected]) => {
        next[entity] = { ...entityState(next, entity), expected };
      });
      return next;
    }

    case 'SET_COMPLETED': {
      const { entity, completed } = action;
      const cur = entityState(state, entity);

      return {
        ...state,
        [entity]: { ...cur, completed },
        lastUpdateTime: now,
      };
    }

    case 'INCR_COMPLETED': {
      const { entity, amount } = action;
      const cur = entityState(state, entity);

      return {
        ...state,
        [entity]: { ...cur, completed: cur.completed + (amount || 0) },
        lastUpdateTime: now,
      };
    }

    case 'MARK_DONE': {
      const { entity, completed } = action;
      const cur = entityState(state, entity);

      // The count the step reports is kept, not replaced by its total. Forcing
      // the two together is what made a run that delivered 16 of 50 products
      // display "50 / 50, done" while the database recorded 16/50 (#761).
      //
      // A count is only taken against a total, and only a step that reports
      // one moves the number: a bypassed step still broadcasts a completion,
      // and the count it carries defaults to 1, which against an entity
      // nothing was asked of would report an item that never existed.
      // Otherwise the count already gathered from the step's batches stands.
      const reported =
        Number.isFinite(completed) && cur.total > 0 ? completed : cur.completed;

      // A step report may raise the count above what the batches show - a
      // step with no batches at all is the only thing that can speak for
      // itself - but it may not lower it. Batch rows are evidence of work
      // performed, so a completion contradicting them downward is not
      // credible: five inventory batches summed 139 items and the sync
      // markers that followed each reported the SDK's default of 1, which
      // #776 had taught this reducer to believe. The bar read 1 / 139 (#799).
      return {
        ...state,
        [entity]: {
          ...cur,
          completed: Math.max(reported, sumBatches(cur.batches, 'completed')),
          isDone: true,
        },
        lastUpdateTime: now,
      };
    }

    case 'UPDATE_BATCH': {
      const { entity, batchId, completed, total } = action;
      const cur = entityState(state, entity);

      const nextBatches = {
        ...cur.batches,
        [batchKey(batchId)]: { completed, total },
      };

      return {
        ...state,
        [entity]: {
          ...cur,
          batches: nextBatches,
          completed: sumBatches(nextBatches, 'completed'),
          total: withRequestFloor(cur, sumBatches(nextBatches, 'total')),
        },
        lastUpdateTime: now,
      };
    }

    case 'ADD_ERRORS': {
      const { entity, errors } = action;
      const cur = entityState(state, entity);
      const newErrors = Array.isArray(errors) ? errors : [errors];
      return {
        ...state,
        [entity]: { ...cur, errors: [...cur.errors, ...newErrors] },
        lastUpdateTime: now,
      };
    }

    default:
      return state;
  }
}

export const ACTIONS = {
  reset: () => ({ type: 'RESET' }),
  setActiveSession: (sessionId, flowType) => ({
    type: 'SET_ACTIVE_SESSION',
    sessionId,
    flowType,
  }),
  setWorkflowStatus: (status) => ({ type: 'SET_WORKFLOW_STATUS', status }),
  setTotal: (entity, total) => ({ type: 'SET_TOTAL', entity, total }),
  setTotals: (totals) => ({ type: 'SET_TOTALS', totals }),
  setExpectedValues: (values) => ({ type: 'SET_EXPECTED_VALUES', values }),
  setCompleted: (entity, completed) => ({
    type: 'SET_COMPLETED',
    entity,
    completed,
  }),
  markDone: (entity, completed) => ({ type: 'MARK_DONE', entity, completed }),
  updateBatch: (entity, batchId, completed, total) => ({
    type: 'UPDATE_BATCH',
    entity,
    batchId,
    completed,
    total,
  }),
  addErrors: (entity, errors) => ({ type: 'ADD_ERRORS', entity, errors }),
  resetAll: (totals) => ({ type: 'RESET_ALL', totals }),
};
