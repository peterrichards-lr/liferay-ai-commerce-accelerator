import { progressReducer, initialProgress, ACTIONS } from './progressReducer';

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

  it('should handle INCR_COMPLETED by adding to the existing completed count', () => {
    let state = progressReducer(initialProgress, {
      type: 'SET_COMPLETED',
      entity: 'skus',
      completed: 10,
    });
    state = progressReducer(state, {
      type: 'INCR_COMPLETED',
      entity: 'skus',
      amount: 5,
    });

    expect(state.skus.completed).toBe(15);
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

describe('entity totals stay separate (#752)', () => {
  // The reducer grows a total to the sum of the batches it has seen, so an
  // entity that absorbs another entity's batches reports a number the operator
  // never asked for. Products and inventory must not share a bucket.
  it('does not add inventory batches to the product total', () => {
    let state = initialProgress;

    state = progressReducer(state, ACTIONS.setTotal('products', 50));
    state = progressReducer(
      state,
      ACTIONS.updateBatch('products', 'batch-products', 50, 50)
    );
    state = progressReducer(
      state,
      ACTIONS.updateBatch('inventory', 'batch-inventory', 200, 200)
    );

    expect(state.products.total).toBe(50);
    expect(state.products.completed).toBe(50);
    expect(state.inventory.total).toBe(200);
    expect(state.inventory.completed).toBe(200);
  });

  it('starts skus and inventory at zero rather than undefined', () => {
    expect(initialProgress.skus).toEqual({
      total: 0,
      completed: 0,
      errors: [],
      batches: {},
    });
    expect(initialProgress.inventory).toEqual({
      total: 0,
      completed: 0,
      errors: [],
      batches: {},
    });
  });
});
