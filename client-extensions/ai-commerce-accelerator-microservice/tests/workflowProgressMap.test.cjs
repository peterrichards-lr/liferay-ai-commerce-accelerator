const {
  STEP_ENTITY_MAP,
  requestedTotals,
  summariseSessionProgress,
} = require('../routes/workflow.cjs');
const BaseWorkflowService = require('../services/baseWorkflowService.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

// The map was inline in the route under a comment claiming it was consistent
// with the SDK's _normalizeEntityType. It was not: the SDK moved
// reset-catalog-config off products and this copy did not (#841).

const PROGRESS_BUCKETS = Object.keys(requestedTotals({}));

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
    // bucket that does not exist is how a step declines to be counted. The
    // list is `requestedTotals`' own keys rather than a copy of them, because
    // a copy is a fourth thing to keep in step: adding a `config` bar would
    // make this fail, which is the reminder that doing so makes the step
    // start reporting again.
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

/**
 * A step's bar is decided three times, once per deployable.
 *
 * The SDK picks the `entityType` that travels on the WebSocket frame, the
 * dashboard's `normalizeEntityType` maps that onto a reducer bucket, and
 * `STEP_ENTITY_MAP` picks the bucket this route counts the step's batch rows
 * into when the dashboard reconnects or polls. #841 pinned the first and the
 * third to each other; the second was pinned to neither, and `update-inventory`
 * drifted out of the third entirely - the live bar read `Inventory 139 / 139`
 * and the polled one `Inventory 0 / 0` (#1003).
 *
 * The dashboard's modules are ES modules and this suite is CommonJS, so they
 * are imported rather than required. Only test code crosses the client
 * extension boundary; neither bundle is affected.
 */
describe('The three copies of the step-entity mapping (#1003)', () => {
  const sdk = new BaseWorkflowService({});

  // The subflow keys never reach `executeNextStep` as steps of their own, but
  // the SDK maps them and a session event can carry them, so they are part of
  // what the dashboard can be asked to put on a bar.
  const EVERY_STEP = [
    ...new Set([
      ...Object.values(WORKFLOW_STEPS),
      'subflow-products',
      'subflow-accounts',
      'subflow-orders',
    ]),
  ];

  const STRUCTURAL = 'names a group of steps, not work of its own';
  const REPORTS_NO_COUNT = 'completes without a count, so both sides read 0/0';
  const LINKS_NOT_ENTITIES =
    "links, unlinks or sweeps - its count is not the bar's entity";
  const LIVE_BAR_CANNOT_COUNT_IT =
    'a synchronous step the live bar reads as 0/0 (see below)';

  /**
   * Steps the wire can put on a bar that this route deliberately does not
   * count. Each entry is a decision, and the test below fails until a new one
   * is made deliberately - which is the whole mechanism.
   *
   * `LINKS_NOT_ENTITIES` is STEP_ENTITY_MAP's own stated rule: a step that
   * links a warehouse to a channel or unlinks a product's options would add
   * its links to the denominator of the entities themselves, which is the
   * inflation #752 was raised about.
   *
   * `LIVE_BAR_CANNOT_COUNT_IT` is the opposite trap, and it is why
   * `link-product-options` is here rather than in the map despite #1003
   * proposing it. A synchronous step reports its count on a step COMPLETED
   * frame; the dashboard's COMPLETED branch dispatches MARK_DONE and ignores
   * the frame's `totalCount` (its PROGRESS branch does not), so MARK_DONE
   * meets a zero total and keeps the zero. Both sides read 0/0 today, and
   * counting the step here alone would make the polled bar disagree with the
   * socket - the defect this file exists to catch, introduced in reverse.
   * `progressPipeline.test.js` holds both sides of that step at 0/0 so the
   * pair moves together.
   */
  const UNCOUNTED_ON_REHYDRATION = {
    'subflow-products': STRUCTURAL,
    'subflow-accounts': STRUCTURAL,
    'subflow-orders': STRUCTURAL,
    'create-promotions': REPORTS_NO_COUNT,
    'delete-option-categories': LINKS_NOT_ENTITIES,
    'delete-product-options': LINKS_NOT_ENTITIES,
    'delete-product-related': LINKS_NOT_ENTITIES,
    'delete-product-specifications': LINKS_NOT_ENTITIES,
    'delete-warehouse-items': LINKS_NOT_ENTITIES,
    'link-addresses': LINKS_NOT_ENTITIES,
    'link-warehouse-channels': LINKS_NOT_ENTITIES,
    'ensure-options': LIVE_BAR_CANNOT_COUNT_IT,
    'ensure-specifications': LIVE_BAR_CANNOT_COUNT_IT,
    'ensure-specification-categories': LIVE_BAR_CANNOT_COUNT_IT,
    'link-product-options': LIVE_BAR_CANNOT_COUNT_IT,
  };

  let normalizeEntityType;
  let dashboardBars;

  beforeAll(async () => {
    ({ normalizeEntityType } =
      await import('../../ai-commerce-accelerator-frontend/src/utils/misc.js'));

    const { initialProgress } =
      await import('../../ai-commerce-accelerator-frontend/src/state/progressReducer.js');

    // `initialProgress` holds the run's own state alongside its bars, and a
    // bar is the entry shaped like one.
    dashboardBars = Object.entries(initialProgress)
      .filter(([, value]) => value !== null && typeof value === 'object')
      .filter(([, value]) => 'completed' in value && 'total' in value)
      .map(([key]) => key);
  });

  /** The bar a step's own frames land on while the socket is up. */
  const liveBarFor = (stepKey) =>
    normalizeEntityType(sdk._normalizeEntityType(stepKey));

  it('counts the stock a run placed, whichever way the bar is read', () => {
    // The bar the SDK has always broadcast to and this route had no bucket
    // for. #799 was diagnosed from an inventory bar reading 1 / 139, so it is
    // the bar that has already cost the most to read wrongly (#1003).
    expect(STEP_ENTITY_MAP['update-inventory']).toBe('inventory');
    expect(PROGRESS_BUCKETS).toContain('inventory');
  });

  it('counts a step into the bar the SDK broadcasts it to', () => {
    Object.entries(STEP_ENTITY_MAP).forEach(([stepKey, entity]) => {
      expect([stepKey, sdk._normalizeEntityType(stepKey)]).toEqual([
        stepKey,
        entity,
      ]);
    });
  });

  it('counts into buckets the dashboard has bars for', () => {
    // The route's bucket has to survive the dashboard's own normalisation, or
    // a figure hydrated into `priceLists` would land somewhere else entirely.
    PROGRESS_BUCKETS.forEach((bucket) => {
      expect([bucket, normalizeEntityType(bucket)]).toEqual([bucket, bucket]);
      expect(dashboardBars).toContain(bucket);
    });
  });

  it('gives every bucket it counts into a total to count against', () => {
    // `summariseSessionProgress` starts from `requestedTotals`, so a bucket
    // missing from it is a step counted into nothing: the batch rows are read,
    // matched to a counter that does not exist and dropped. That is exactly
    // what `update-inventory` did (#1003).
    Object.values(STEP_ENTITY_MAP).forEach((entity) => {
      if (!dashboardBars.includes(entity)) return;
      expect([entity, PROGRESS_BUCKETS.includes(entity)]).toEqual([
        entity,
        true,
      ]);
    });
  });

  it('counts every step the wire puts on a bar, or records why not', () => {
    EVERY_STEP.forEach((stepKey) => {
      const liveBar = liveBarFor(stepKey);

      if (!dashboardBars.includes(liveBar)) return;

      const counted = STEP_ENTITY_MAP[stepKey];
      const excused = UNCOUNTED_ON_REHYDRATION[stepKey];

      expect([stepKey, Boolean(counted || excused)]).toEqual([stepKey, true]);

      if (counted) {
        expect([stepKey, counted]).toEqual([stepKey, liveBar]);
      }
    });
  });

  it('holds no excuse for a step the wire keeps off every bar', () => {
    // An exclusion that no longer describes anything is a reader's dead end:
    // it says a step is deliberately uncounted when nothing would have counted
    // it anyway.
    Object.keys(UNCOUNTED_ON_REHYDRATION).forEach((stepKey) => {
      expect([stepKey, dashboardBars.includes(liveBarFor(stepKey))]).toEqual([
        stepKey,
        true,
      ]);
    });
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

  it('takes the inventory total from the items, not from the request', () => {
    // One batch per warehouse, each carrying the items it attempted. Nothing
    // in the request implies 139: the run asked for 7 products, and what they
    // amount to in stock depends on how many SKUs each carries and how many
    // warehouses they were spread over. The rows are the only place the
    // number exists (#1003).
    const { inventory } = summariseSessionProgress({
      batches: [30, 30, 30, 30, 19].map((size) => ({
        step_key: 'update-inventory',
        processed_count: size,
        total_count: size,
      })),
      options: { productCount: 7 },
    });

    expect(inventory).toEqual({ completed: 139, total: 139 });
  });

  it('leaves the inventory bar at nothing when no stock was placed', () => {
    // A bucket that exists and reads 0/0 is what the hydration skips - it only
    // dispatches an entity whose total is above zero - so adding the bucket
    // changes nothing for a run that placed no stock.
    const progress = summariseSessionProgress({
      batches: [],
      options: IMPORT_OPTIONS,
    });

    expect(progress.inventory).toEqual({ completed: 0, total: 0 });
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
