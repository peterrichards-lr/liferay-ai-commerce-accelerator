export const initialProgress = {
  activeSessionId: null,
  products: { total: 0, completed: 0, errors: [], batches: {} },
  accounts: { total: 0, completed: 0, errors: [], batches: {} },
  orders: { total: 0, completed: 0, errors: [], batches: {} },
  images: { expected: 0, total: 0, completed: 0, errors: [], batches: {} },
  pdfs: { expected: 0, total: 0, completed: 0, errors: [], batches: {} },
  warehouses: { total: 0, completed: 0, errors: [], batches: {} },
};

export function progressReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return initialProgress;

    case 'APPLY_UPDATER': {
      const next = action.updater(state);
      return next ?? state;
    }

    case 'MERGE': {
      return { ...state, ...action.payload };
    }

    case 'SET_ACTIVE_SESSION': {
      return { ...state, activeSessionId: action.sessionId };
    }

    case 'SET_TOTAL': {
      const { entity, total } = action;
      const cur = state[entity] || {
        total: 0,
        completed: 0,
        errors: [],
        batches: {},
      };
      // When a new total is set, we clear batches to avoid double-counting
      // from previous steps that might have mapped to the same entity.
      return {
        ...state,
        [entity]: { ...cur, total, batches: {}, completed: 0 },
      };
    }

    case 'SET_COMPLETED': {
      const { entity, completed } = action;
      const cur = state[entity] || {
        total: 0,
        completed: 0,
        errors: [],
        batches: {},
      };
      return { ...state, [entity]: { ...cur, completed } };
    }

    case 'SET_COMPLETED_TO_TOTAL': {
      const { entity } = action;
      const cur = state[entity] || {
        total: 0,
        completed: 0,
        errors: [],
        batches: {},
      };
      return { ...state, [entity]: { ...cur, completed: cur.total } };
    }

    case 'INCR_COMPLETED': {
      const { entity, amount = 1 } = action;
      const cur = state[entity] || {
        total: 0,
        completed: 0,
        errors: [],
        batches: {},
      };
      return {
        ...state,
        [entity]: { ...cur, completed: cur.completed + amount },
      };
    }

    case 'UPDATE_BATCH': {
      const { entity, batchId, completed, total } = action;
      const cur = state[entity] || {
        total: 0,
        completed: 0,
        errors: [],
        batches: {},
      };

      const nextBatches = {
        ...cur.batches,
        [batchId]: { completed, total },
      };

      // Sum up all active batches for this entity
      const summedCompleted = Object.values(nextBatches).reduce(
        (sum, b) => sum + (b.completed || 0),
        0
      );

      // Use the max of the explicitly set 'total' or the sum of batch totals
      const summedTotal = Math.max(
        cur.total,
        Object.values(nextBatches).reduce((sum, b) => sum + (b.total || 0), 0)
      );

      return {
        ...state,
        [entity]: {
          ...cur,
          batches: nextBatches,
          completed: summedCompleted,
          total: summedTotal,
        },
      };
    }

    case 'ADD_ERRORS': {
      const { entity, errors } = action;
      const cur = state[entity] || {
        total: 0,
        completed: 0,
        errors: [],
        batches: {},
      };
      const add = Array.isArray(errors) ? errors : [errors];
      return {
        ...state,
        [entity]: { ...cur, errors: [...cur.errors, ...add] },
      };
    }

    case 'RESET_ALL': {
      const withTotals = action.totals || {};
      const base = JSON.parse(JSON.stringify(initialProgress));
      for (const [entity, total] of Object.entries(withTotals)) {
        if (!base[entity])
          base[entity] = { total: 0, completed: 0, errors: [], batches: {} };
        base[entity].total = total;
      }
      return base;
    }

    case 'SET_TOTALS': {
      const { totals } = action;
      const nextState = { ...state };
      for (const [entity, total] of Object.entries(totals)) {
        if (nextState[entity]) {
          nextState[entity] = {
            ...nextState[entity],
            total,
            completed: Math.min(nextState[entity].completed, total),
          };
        }
      }
      return nextState;
    }

    case 'SET_EXPECTED_VALUES': {
      const { values } = action;
      return {
        ...state,
        images: { ...state.images, expected: values.images },
        pdfs: { ...state.pdfs, expected: values.pdfs },
      };
    }

    default:
      return state;
  }
}

export const ProgressActions = {
  apply: (updater) => ({ type: 'APPLY_UPDATER', updater }),
  merge: (payload) => ({ type: 'MERGE', payload }),
  setActiveSession: (sessionId) => ({ type: 'SET_ACTIVE_SESSION', sessionId }),
  setTotal: (entity, total) => ({ type: 'SET_TOTAL', entity, total }),
  setCompleted: (entity, completed) => ({
    type: 'SET_COMPLETED',
    entity,
    completed,
  }),
  setCompletedToTotal: (entity) => ({ type: 'SET_COMPLETED_TO_TOTAL', entity }),
  incrCompleted: (entity, amount = 1) => ({
    type: 'INCR_COMPLETED',
    entity,
    amount,
  }),
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
