const {
  STEP_ENTITY_MAP,
  summariseSessionProgress,
} = require('../routes/workflow.cjs');

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

describe('Session progress counters', () => {
  // The rows a successful seven-product import actually wrote: one batch per
  // product for products and SKUs, and four for the pricing step - the
  // catalog's standard list, the promotions list and two lists with nothing
  // to put in them.
  const IMPORT_BATCHES = [
    ...Array.from({ length: 7 }, () => ({
      step_key: 'create-products',
      processed_count: 1,
      total_count: 1,
    })),
    ...Array.from({ length: 7 }, () => ({
      step_key: 'create-skus',
      processed_count: 1,
      total_count: 1,
    })),
    { step_key: 'create-price-lists', processed_count: 47, total_count: 47 },
    { step_key: 'create-price-lists', processed_count: 10, total_count: 10 },
    { step_key: 'create-price-lists', processed_count: 0, total_count: 0 },
    { step_key: 'create-price-lists', processed_count: 0, total_count: 0 },
    { step_key: 'create-images', processed_count: 7, total_count: 7 },
    { step_key: 'create-pdfs', processed_count: 7, total_count: 7 },
  ];

  const IMPORT_OPTIONS = {
    imageMode: 'placeholder',
    imageRatio: 100,
    pdfMode: 'placeholder',
    pdfRatio: 100,
    productCount: 7,
  };

  it('never reports more completed than its own total', () => {
    // `completed` summed every batch while `total` took the largest single
    // one, so a step submitting one batch per product counted all of them
    // against the size of one. The run that found it read `skus 22/1` and
    // `priceLists 104/52` with every entity correct in the target (#891).
    const progress = summariseSessionProgress({
      batches: IMPORT_BATCHES,
      options: IMPORT_OPTIONS,
    });

    Object.entries(progress).forEach(([entity, { completed, total }]) => {
      expect(
        completed,
        `${entity} reported ${completed} of ${total}`
      ).toBeLessThanOrEqual(total);
    });
  });

  it('counts one batch per product against the number of products', () => {
    const { skus } = summariseSessionProgress({
      batches: IMPORT_BATCHES,
      options: IMPORT_OPTIONS,
    });

    expect(skus).toEqual({ completed: 7, total: 7 });
  });

  it("takes a step's fan-out as the total rather than one batch of it", () => {
    // 47 standard prices and 10 promotional ones are 57 price entries, not 47
    // with ten of them uncounted.
    const { priceLists } = summariseSessionProgress({
      batches: IMPORT_BATCHES,
      options: IMPORT_OPTIONS,
    });

    expect(priceLists).toEqual({ completed: 57, total: 57 });
  });

  it('keeps what was requested as a floor under what was delivered', () => {
    // 16 products delivered against 50 asked for is 16/50, not 16/16 (#756).
    const { products } = summariseSessionProgress({
      batches: [
        { step_key: 'create-products', processed_count: 16, total_count: 16 },
      ],
      options: { productCount: 50 },
    });

    expect(products).toEqual({ completed: 16, total: 50 });
  });

  it('shows what a run asked for before any batch has reported', () => {
    const progress = summariseSessionProgress({
      batches: [],
      options: IMPORT_OPTIONS,
    });

    expect(progress.products).toEqual({ completed: 0, total: 7 });
    expect(progress.images).toEqual({ completed: 0, total: 7 });
  });

  it('counts a failed batch as attempted but not completed', () => {
    // The step that lost one price entry of 47 reported `0/47`. The
    // denominator is what makes that readable as a near miss rather than as
    // nothing having happened (#892).
    const { priceLists } = summariseSessionProgress({
      batches: [
        {
          step_key: 'create-price-lists',
          processed_count: 46,
          total_count: 47,
        },
      ],
      options: {},
    });

    expect(priceLists).toEqual({ completed: 46, total: 47 });
  });
});
