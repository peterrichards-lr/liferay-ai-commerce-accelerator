export const initialProgress = {
  activeSessionId: null,
  products: { total: 0, completed: 0, errors: [], batches: {} },
  accounts: { total: 0, completed: 0, errors: [], batches: {} },
  orders: { total: 0, completed: 0, errors: [], batches: {} },
  images: { expected: 0, total: 0, completed: 0, errors: [], batches: {} },
  pdfs: { expected: 0, total: 0, completed: 0, errors: [], batches: {} },
  warehouses: { total: 0, completed: 0, errors: [], batches: {} },
  specifications: { total: 0, completed: 0, errors: [], batches: {} },
  options: { total: 0, completed: 0, errors: [], batches: {} },
  priceLists: { total: 0, completed: 0, errors: [], batches: {} },
  promotions: { total: 0, completed: 0, errors: [], batches: {} },
};

export function progressReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return initialProgress;

    case 'RESET_ALL': {
      const next = { ...initialProgress };
      if (action.totals) {
        Object.entries(action.totals).forEach(([k, v]) => {
          if (next[k]) next[k].total = v;
        });
      }
      return next;
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
      // HARDENING: We no longer clear completed/batches here.
      // This ensures stability when multiple steps map to the same entity.
      return {
        ...state,
        [entity]: { ...cur, total },
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
      const cur = state[entity];
      if (!cur) return state;
      return { ...state, [entity]: { ...cur, completed: cur.total } };
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

      // Sum up the totals from all batches.
      const summedBatchTotals = Object.values(nextBatches).reduce(
        (sum, b) => sum + (b.total || 0),
        0
      );

      // If we have an explicitly set total (e.g. from generation config),
      // we use it as a 'base', but we allow the actual total to expand
      // if batches report more.
      const summedTotal = Math.max(cur.total, summedBatchTotals);

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
      return {
        ...state,
        [entity]: { ...cur, errors: [...cur.errors, ...errors] },
      };
    }

    default:
      return state;
  }
}

export const ACTIONS = {
  reset: () => ({ type: 'RESET' }),
  setActiveSession: (sessionId) => ({ type: 'SET_ACTIVE_SESSION', sessionId }),
  setTotal: (entity, total) => ({ type: 'SET_TOTAL', entity, total }),
  setCompleted: (entity, completed) => ({
    type: 'SET_COMPLETED',
    entity,
    completed,
  }),
  setCompletedToTotal: (entity) => ({ type: 'SET_COMPLETED_TO_TOTAL', entity }),
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
