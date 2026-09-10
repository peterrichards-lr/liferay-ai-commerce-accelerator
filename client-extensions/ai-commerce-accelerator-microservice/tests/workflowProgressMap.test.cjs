const { STEP_ENTITY_MAP } = require('../routes/workflow.cjs');

// The map was inline in the route under a comment claiming it was consistent
// with the SDK's _normalizeEntityType. It was not: the SDK moved
// reset-catalog-config off products and this copy did not (#841).

describe('Workflow progress step mapping', () => {
  it('does not count a catalog-config reset against products', () => {
    // Resetting a catalog's configuration deletes nothing. Counting its one
    // reported unit against products showed "Products 1 Deleted, Done" while
    // delete-products was still PREPARED at 0 of 50 (#786).
    expect(STEP_ENTITY_MAP['reset-catalog-config']).not.toBe('products');
    expect(STEP_ENTITY_MAP['reset-catalog-config']).toBe('config');
  });

  it('maps a catalog-config reset outside every progress bucket', () => {
    // The accumulator guards with `if (entity && progress[entity])`, so a
    // bucket that does not exist is how a step declines to be counted. If a
    // `config` bar is ever added, this test is the reminder that doing so
    // makes the step start reporting again.
    const PROGRESS_BUCKETS = [
      'products',
      'skus',
      'accounts',
      'orders',
      'priceLists',
      'promotions',
      'images',
      'pdfs',
      'warehouses',
      'options',
      'specifications',
      'addresses',
    ];

    expect(PROGRESS_BUCKETS).not.toContain(
      STEP_ENTITY_MAP['reset-catalog-config']
    );
  });

  it('still counts the steps that do create or delete', () => {
    expect(STEP_ENTITY_MAP['create-products']).toBe('products');
    expect(STEP_ENTITY_MAP['delete-products']).toBe('products');
    expect(STEP_ENTITY_MAP['create-orders']).toBe('orders');
  });
});
