import { clampCompleted } from '../state/progressSelectors';

export const initialProgress = {
  products: { total: 0, completed: 0, errors: [] },
  accounts: { total: 0, completed: 0, errors: [] },
  orders: { total: 0, completed: 0, errors: [] },
  images: { total: 0, completed: 0, errors: [] },
  pdfs: { total: 0, completed: 0, errors: [] },
};

export function progressReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return initialProgress;
    case 'SET_PRODUCTS_TOTAL':
      return {
        ...state,
        products: {
          ...state.products,
          total: action.total,
          completed: clampCompleted(state.products.completed, action.total),
        },
      };
    case 'APPLY_UPDATER': {
      const next = action.updater(state);
      return next ?? state;
    }

    case 'MERGE': {
      return { ...state, ...action.payload };
    }

    case 'SET_TOTAL': {
      const { entity, total } = action;
      const cur = state[entity] || { total: 0, completed: 0, errors: [] };
      return { ...state, [entity]: { ...cur, total } };
    }

    case 'SET_COMPLETED': {
      const { entity, completed } = action;
      const cur = state[entity] || { total: 0, completed: 0, errors: [] };
      return { ...state, [entity]: { ...cur, completed } };
    }

    case 'INCR_COMPLETED': {
      const { entity, amount = 1 } = action;
      const cur = state[entity] || { total: 0, completed: 0, errors: [] };
      return {
        ...state,
        [entity]: { ...cur, completed: cur.completed + amount },
      };
    }

    case 'ADD_ERRORS': {
      const { entity, errors } = action;
      const cur = state[entity] || { total: 0, completed: 0, errors: [] };
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
          base[entity] = { total: 0, completed: 0, errors: [] };
        base[entity].total = total;
      }
      return base;
    }

    default:
      return state;
  }
}

export const ProgressActions = {
  apply: (updater) => ({ type: 'APPLY_UPDATER', updater }),
  merge: (payload) => ({ type: 'MERGE', payload }),
  setTotal: (entity, total) => ({ type: 'SET_TOTAL', entity, total }),
  setCompleted: (entity, completed) => ({
    type: 'SET_COMPLETED',
    entity,
    completed,
  }),
  incrCompleted: (entity, amount = 1) => ({
    type: 'INCR_COMPLETED',
    entity,
    amount,
  }),
  addErrors: (entity, errors) => ({ type: 'ADD_ERRORS', entity, errors }),
  resetAll: (totals) => ({ type: 'RESET_ALL', totals }),
};

export const resetProgress = () => ({ type: 'RESET' });
export const setProductsTotal = (total) => ({
  type: 'SET_PRODUCTS_TOTAL',
  total,
});
