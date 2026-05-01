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

    case 'MERGE':
      return { ...state, ...action.payload };

    case 'APPLY_UPDATER':
      return action.updater(state);

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
      return {
        ...state,
        [entity]: { ...cur, total },
      };
    }

    case 'SET_TOTALS': {
      const next = { ...state };
      Object.entries(action.totals).forEach(([entity, total]) => {
        const cur = next[entity] || {
          total: 0,
          completed: 0,
          errors: [],
          batches: {},
        };
        next[entity] = { ...cur, total };
      });
      return next;
    }

    case 'SET_EXPECTED_VALUES': {
      const next = { ...state };
      Object.entries(action.values).forEach(([entity, expected]) => {
        const cur = next[entity] || {
          total: 0,
          completed: 0,
          errors: [],
          batches: {},
        };
        next[entity] = { ...cur, expected };
      });
      return next;
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

      const summedCompleted = Object.values(nextBatches).reduce(
        (sum, b) => sum + (b.completed || 0),
        0
      );

      const summedBatchTotals = Object.values(nextBatches).reduce(
        (sum, b) => sum + (b.total || 0),
        0
      );

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
  setTotals: (totals) => ({ type: 'SET_TOTALS', totals }),
  setExpectedValues: (values) => ({ type: 'SET_EXPECTED_VALUES', values }),
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
