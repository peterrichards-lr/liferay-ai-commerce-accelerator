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
      requested: 0,
      completed: 0,
      errors: [],
      batches: {},
      isDone: false,
    });
    expect(initialProgress.inventory).toEqual({
      total: 0,
      requested: 0,
      completed: 0,
      errors: [],
      batches: {},
      isDone: false,
    });
  });
});

// The 2026-09-08 run asked for 50 products and the AI delivered 16. The
// database recorded generate-product-data as 16/50; the bar read 50 / 50, Done.
describe('a step that finished short says so (#761, #756)', () => {
  const runAskingFor50Products = () =>
    progressReducer(initialProgress, ACTIONS.resetAll({ products: 50 }));

  it('keeps the count a finishing step reports instead of filling to the total', () => {
    let state = runAskingFor50Products();
    state = progressReducer(state, ACTIONS.markDone('products', 16));

    expect(state.products.completed).toBe(16);
    expect(state.products.total).toBe(50);
    expect(state.products.isDone).toBe(true);
  });

  it('leaves the count already gathered when a step reports none', () => {
    let state = runAskingFor50Products();
    state = progressReducer(
      state,
      ACTIONS.updateBatch('products', 'b1', 16, 16)
    );
    state = progressReducer(state, ACTIONS.markDone('products'));

    expect(state.products.completed).toBe(16);
    expect(state.products.total).toBe(50);
    expect(state.products.isDone).toBe(true);
  });

  it('does not let a later step lower the total to what the run produced', () => {
    let state = runAskingFor50Products();

    // create-products only has the 16 products that survived generation.
    state = progressReducer(state, ACTIONS.setTotal('products', 16));
    state = progressReducer(
      state,
      ACTIONS.updateBatch('products', 'b1', 10, 10)
    );
    state = progressReducer(state, ACTIONS.updateBatch('products', 'b2', 6, 6));
    state = progressReducer(state, ACTIONS.markDone('products', 16));

    expect(state.products.completed).toBe(16);
    expect(state.products.total).toBe(50);
  });

  it('still grows a total past the request when the run produces more', () => {
    let state = runAskingFor50Products();
    state = progressReducer(
      state,
      ACTIONS.updateBatch('products', 'b1', 60, 60)
    );

    expect(state.products.total).toBe(60);
  });

  it('ignores the count from a step nothing was asked of', () => {
    // A bypassed step still broadcasts a completion, carrying the count the
    // SDK defaults to.
    const state = progressReducer(
      initialProgress,
      ACTIONS.markDone('orders', 1)
    );

    expect(state.orders.completed).toBe(0);
    expect(state.orders.isDone).toBe(true);
  });

  it('does not write a run total back into the shared initial state', () => {
    progressReducer(initialProgress, ACTIONS.resetAll({ products: 50 }));

    expect(initialProgress.products.total).toBe(0);
    expect(initialProgress.products.requested).toBe(0);
  });
});

// create-skus submits a product batch - a product upsert carrying SKUs - so
// Liferay completes it with a product count. resolve-sku-ids is the step that
// counts SKUs, and it is the one that must have the last word on the bar.
describe('the SKU bar ends on SKUs, not on products (#756)', () => {
  it('reports the SKUs resolved rather than the products that carried them', () => {
    let state = initialProgress;

    state = progressReducer(state, ACTIONS.setTotal('skus', 10));
    state = progressReducer(
      state,
      ACTIONS.updateBatch('skus', 'sku-batch', 10, 10)
    );
    state = progressReducer(state, ACTIONS.markDone('skus', 10));

    // resolve-sku-ids: 90 SKU references, all resolved.
    state = progressReducer(state, ACTIONS.setTotal('skus', 90));
    state = progressReducer(state, ACTIONS.markDone('skus', 90));

    expect(state.skus.completed).toBe(90);
    expect(state.skus.total).toBe(90);
    expect(state.skus.isDone).toBe(true);
  });

  it('reports a shortfall when fewer SKUs resolve than were sent', () => {
    let state = progressReducer(initialProgress, ACTIONS.setTotal('skus', 90));
    state = progressReducer(state, ACTIONS.markDone('skus', 84));

    expect(state.skus.completed).toBe(84);
    expect(state.skus.total).toBe(90);
    expect(state.skus.isDone).toBe(true);
  });
});

describe('one batch, one key (#776 follow-up)', () => {
  // Liferay's batch id arrives as both 536 and '536.0' - the submit records
  // one form and the callback the other. Keying on the raw value filed one
  // batch under two entries and counted its items twice. A live run showed
  // Products 70 / 50.
  it('does not count a batch twice when its id arrives in two forms', () => {
    let state = initialProgress;

    state = progressReducer(state, ACTIONS.setTotal('products', 50));
    state = progressReducer(
      state,
      ACTIONS.updateBatch('products', 536, 10, 10)
    );
    state = progressReducer(
      state,
      ACTIONS.updateBatch('products', '536.0', 10, 10)
    );

    expect(state.products.completed).toBe(10);
    expect(state.products.total).toBe(50);
  });

  it('still counts genuinely different batches separately', () => {
    let state = initialProgress;

    state = progressReducer(state, ACTIONS.setTotal('products', 50));
    state = progressReducer(
      state,
      ACTIONS.updateBatch('products', 536, 10, 10)
    );
    state = progressReducer(
      state,
      ACTIONS.updateBatch('products', 537, 10, 10)
    );

    expect(state.products.completed).toBe(20);
  });

  // The simulated batches carry ids like 'simulated-inventory-batch-1788...'
  // which must not be flattened into each other.
  it('leaves a non-numeric batch id as its own key', () => {
    let state = initialProgress;

    state = progressReducer(
      state,
      ACTIONS.updateBatch('inventory', 'simulated-batch-1', 5, 5)
    );
    state = progressReducer(
      state,
      ACTIONS.updateBatch('inventory', 'simulated-batch-2', 5, 5)
    );

    expect(state.inventory.completed).toBe(10);
  });

  it('does not let a missing id collide with batch zero', () => {
    let state = initialProgress;

    state = progressReducer(state, ACTIONS.updateBatch('products', 0, 3, 3));
    state = progressReducer(state, ACTIONS.updateBatch('products', null, 4, 4));

    expect(state.products.completed).toBe(7);
  });
});

// A delete run showed "Products 1 Deleted, Done" while delete-products was
// still PREPARED at 0 of 50, and the final export read "accounts: 10 / 2".
describe('a delete reports what it removed, over what it found (#786)', () => {
  it('does not claim an item was deleted from an entity nothing was found for', () => {
    // Discovery found nothing, and the bypassed step still broadcast a
    // completion carrying the count the SDK defaults to.
    const state = progressReducer(initialProgress, ACTIONS.markDone('pdfs', 1));

    expect(state.pdfs.completed).toBe(0);
    expect(state.pdfs.isDone).toBe(true);
  });

  it('does not claim an item was deleted from a step that removed none', () => {
    let state = progressReducer(initialProgress, ACTIONS.setTotal('skus', 90));
    state = progressReducer(state, ACTIONS.markDone('skus', 0));

    expect(state.skus.completed).toBe(0);
  });

  // A delete requests nothing, so discovery's census is the only floor the
  // denominator has. Without it a narrower later report took the total with
  // it and the bar read more removed than there was to remove.
  it('does not let a later step narrow the total discovery established', () => {
    let state = progressReducer(
      initialProgress,
      ACTIONS.setTotal('accounts', 10)
    );
    state = progressReducer(state, ACTIONS.setTotal('accounts', 2));
    state = progressReducer(state, ACTIONS.markDone('accounts', 10));

    expect(state.accounts.completed).toBe(10);
    expect(state.accounts.total).toBe(10);
  });

  it('does not let a batch total narrow the total discovery established', () => {
    let state = progressReducer(
      initialProgress,
      ACTIONS.setTotal('orders', 32)
    );
    state = progressReducer(
      state,
      ACTIONS.updateBatch('orders', 'order-batch', 12, 12)
    );

    expect(state.orders.total).toBe(32);
    expect(state.orders.completed).toBe(12);
  });

  it('still seeds a fresh run rather than inheriting the last one', () => {
    let state = progressReducer(
      initialProgress,
      ACTIONS.setTotal('products', 500)
    );
    state = progressReducer(state, ACTIONS.resetAll({ products: 50 }));

    expect(state.products.total).toBe(50);
    expect(state.products.requested).toBe(50);
  });
});
