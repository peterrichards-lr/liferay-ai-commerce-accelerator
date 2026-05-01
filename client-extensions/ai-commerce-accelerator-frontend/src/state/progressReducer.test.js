import { progressReducer, initialProgress } from './progressReducer';

describe('progressReducer', () => {
  it('should return provided state for unknown action', () => {
    expect(progressReducer(initialProgress, { type: 'UNKNOWN' })).toEqual(
      initialProgress
    );
  });

  it('should handle SET_TOTAL', () => {
    const action = { type: 'SET_TOTAL', entity: 'products', total: 100 };
    const state = progressReducer(initialProgress, action);
    expect(state.products.total).toBe(100);
  });

  it('should handle SET_COMPLETED', () => {
    const action = { type: 'SET_COMPLETED', entity: 'products', completed: 50 };
    const state = progressReducer(initialProgress, action);
    expect(state.products.completed).toBe(50);
  });

  it('should handle UPDATE_BATCH and sum correctly', () => {
    const action1 = {
      type: 'UPDATE_BATCH',
      entity: 'products',
      batchId: 'b1',
      completed: 10,
      total: 20,
    };
    let state = progressReducer(initialProgress, action1);

    expect(state.products.completed).toBe(10);
    expect(state.products.total).toBe(20);
    expect(state.products.batches.b1).toEqual({ completed: 10, total: 20 });

    const action2 = {
      type: 'UPDATE_BATCH',
      entity: 'products',
      batchId: 'b2',
      completed: 5,
      total: 15,
    };
    state = progressReducer(state, action2);

    expect(state.products.completed).toBe(15); // 10 + 5
    expect(state.products.total).toBe(35); // 20 + 15
  });

  it('should handle RESET_ALL', () => {
    const initialState = {
      ...initialProgress,
      products: { total: 10, completed: 5, errors: [], batches: {} },
    };
    const action = { type: 'RESET_ALL', totals: { accounts: 20 } };
    const state = progressReducer(initialState, action);

    expect(state.products.completed).toBe(0);
    expect(state.accounts.total).toBe(20);
  });
});
