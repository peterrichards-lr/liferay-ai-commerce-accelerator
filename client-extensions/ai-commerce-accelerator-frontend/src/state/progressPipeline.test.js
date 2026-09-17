/**
 * One run, counted by all three deployables, compared.
 *
 * Every layer of progress reporting is well covered on its own and the
 * composition has still produced five defects found by a person watching a
 * progress bar (#799, #784, #791, #786, #891). The reason is visible in the
 * existing suites: the microservice asserts the payload it hands its own
 * WebSocket service, and the frontend asserts what it does with a frame it
 * wrote itself. Neither side has ever read the other's. Every hand-written
 * frame in `useRealtimeWebSocket.test.js` carries a `type` field, for
 * instance, and `ProgressService` has never emitted one - the frames it sends
 * carry `status`. Deleting `|| data.status` from the hook passes the whole
 * frontend suite and breaks every real run.
 *
 * So nothing here writes a frame or a batch row. The SDK submits the batches
 * and completes the steps, `ProgressService` shapes the events,
 * `WebSocketService.broadcast` serialises them, the hook parses them and the
 * reducer accumulates them - all the real modules, wired together. The only
 * stand-ins are a database, an HTTP client and a socket, none of which
 * contain arithmetic.
 *
 * What this cannot do without a live instance: prove Liferay's callback
 * bodies look like the fixtures here, or that a generator submits the batches
 * it should. Those need an instance and are out of scope. What it does prove
 * is that a number leaving the SDK arrives on the dashboard meaning the same
 * thing - which is the specific failure #800 was raised about.
 *
 * It lives in the frontend because the hook needs React and a DOM, and reaches
 * across the client-extension boundary to read the microservice's modules.
 * That coupling is the point: the two are deployed separately and speak to
 * each other, and nothing else in either suite ever checks that they agree.
 * Only test code crosses - the built bundle is unaffected.
 */
import { createRequire } from 'module';
import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import useRealtimeWebSocket from '../hooks/useRealtimeWebSocket';
import { initialProgress, progressReducer } from './progressReducer';
import { computeTotalsFromConfig } from './progressSelectors';
import { useApp } from '../context/AppContext';

const require = createRequire(import.meta.url);

const ProgressService = require('../../../ai-commerce-accelerator-microservice/services/progressService.cjs');
const {
  WebSocketService,
} = require('../../../ai-commerce-accelerator-microservice/services/webSocketService.cjs');
const {
  summariseSessionProgress,
} = require('../../../ai-commerce-accelerator-microservice/routes/workflow.cjs');
const {
  WORKFLOW_STEPS: S,
} = require('../../../ai-commerce-accelerator-microservice/utils/constants.cjs');
const {
  BaseGenerator,
  BatchCallbackService,
} = require('@liferay/accelerator-sdk');

vi.mock('../context/AppContext', () => ({ useApp: vi.fn() }));

const SESSION_ID = 'aica-session-1';
const CORRELATION_ID = 'aica-correlation-1';

const silentLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

/**
 * The microservice, minus its database and its socket.
 *
 * `rows` stands in for `workflow_batches` in the shape the persistence layer
 * stores it - snake_case columns - because that is what the status route
 * reads back and what `summariseSessionProgress` is given.
 */
function startMicroservice({ flowType = 'generate', config = {} } = {}) {
  const frames = [];
  const rows = new Map();
  const importTasks = new Map();
  const logger = silentLogger();

  const session = {
    session_id: SESSION_ID,
    flow_type: flowType,
    status: 'STARTED',
    correlationId: CORRELATION_ID,
    context: { config, generator: 'product' },
  };

  const persistence = {
    getSession: async () => session,
    getBatch: async (erc) => rows.get(erc),
    getBatchesForSession: async () => [...rows.values()],
    createBatch: async ({ erc, stepKey, status, processedCount, totalCount }) =>
      rows.set(erc, {
        erc,
        session_id: SESSION_ID,
        step_key: stepKey,
        status,
        processed_count: processedCount ?? null,
        total_count: totalCount ?? null,
      }),
    updateBatch: async (erc, patch) => {
      const row = rows.get(erc);
      if (!row) return;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.processedCount !== undefined)
        row.processed_count = patch.processedCount;
      if (patch.totalCount !== undefined) row.total_count = patch.totalCount;
    },
    logWorkflowEvent: vi.fn(),
    tryFailSession: async () => false,
    updateSession: async () => {},
  };

  const ws = new WebSocketService({ logger });
  // `broadcast` sends to every client whose readyState is `ws.OPEN`, which is
  // 1. Registering a fake client is how the real serialisation is exercised
  // rather than reimplemented.
  ws.clients.set('dashboard', {
    readyState: 1,
    send: (payload) => frames.push(payload),
  });

  const progress = new ProgressService({ ws, logger, persistence });

  const liferay = {
    getImportTask: async (_config, batchId) => importTasks.get(String(batchId)),
    getImportTaskFailedItemReport: async (_config, batchId) =>
      importTasks.get(String(batchId))?.failedItems || [],
  };

  // `executeNextStep` is the orchestration loop, not progress reporting, and
  // driving it needs the whole generator registry. `_normalizeEntityType` -
  // which decides the bar a step reports against, and has drifted before
  // (#841) - stays the SDK's.
  class HaltedGenerator extends BaseGenerator {
    async executeNextStep() {
      return true;
    }
  }

  const ctx = { logger, persistence, progress, liferay };
  const generator = new HaltedGenerator(ctx);
  const batchCallback = new BatchCallbackService(ctx);
  batchCallback.registerGenerator('product', generator);
  ctx.batchCallback = batchCallback;

  return {
    frames,
    generator,
    progress,
    batches: () => [...rows.values()],

    /** A step submits `itemsCount` items and Liferay accepts them. */
    async submitBatch(stepKey, itemsCount, batchId) {
      const { batchERC } = await generator.submitBatch(
        SESSION_ID,
        stepKey,
        generator._normalizeEntityType(stepKey),
        flowType,
        async () => ({ batchId }),
        itemsCount
      );
      return batchERC;
    },

    /** Liferay reports the batch finished, and the SDK processes it. */
    async completeBatch(batchERC, batchId, { processed, total, failed = [] }) {
      importTasks.set(String(batchId), {
        executeStatus: 'COMPLETED',
        processedItemsCount: processed,
        totalItemsCount: total,
        failedItems: failed,
      });

      await batchCallback.processCallbackInternal(
        batchERC,
        { [String(batchId)]: 'COMPLETED' },
        CORRELATION_ID,
        SESSION_ID,
        String(batchId)
      );
    },
  };
}

let nextBatchId = 100;

/**
 * A whole step: every batch submitted, then every callback.
 *
 * Which order those two phases interleave in is Liferay's to decide - a
 * callback for the first batch can arrive while the last is still being
 * submitted - so `interleaved` runs the other extreme. A progress bar that
 * reads differently depending on which happened is reporting on the network
 * rather than on the run.
 */
async function runStep(service, stepKey, sizes, { interleaved = false } = {}) {
  const submitted = [];

  for (const size of sizes) {
    const batchId = (nextBatchId += 1);
    const erc = await service.submitBatch(stepKey, size, batchId);
    submitted.push({ erc, batchId, size });

    if (interleaved) {
      await service.completeBatch(erc, batchId, {
        processed: size,
        total: size,
      });
    }
  }

  if (interleaved) return;

  for (const { erc, batchId, size } of submitted) {
    await service.completeBatch(erc, batchId, { processed: size, total: size });
  }
}

/**
 * The dashboard, minus its socket.
 *
 * `onProgress` is the real reducer rather than a spy: the question is what an
 * operator reads, not which actions were dispatched.
 */
function openDashboard({ statusResponse = null } = {}) {
  let socket = null;
  let state = initialProgress;

  class CapturedWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.send = vi.fn();
      this.close = vi.fn();
      socket = this;
    }
  }

  vi.stubGlobal('WebSocket', CapturedWebSocket);

  const api = { get: vi.fn().mockResolvedValue(statusResponse) };
  useApp.mockReturnValue({ getCorrelationId: () => CORRELATION_ID, api });

  renderHook(() =>
    useRealtimeWebSocket({
      enabled: true,
      microserviceUrl: 'http://localhost:3001',
      onLog: vi.fn(),
      onProgress: (action) => {
        state = progressReducer(state, action);
      },
      activeSessionId: statusResponse ? SESSION_ID : null,
    })
  );

  return {
    /** What `useGeneration` seeds from the operator's form before submitting. */
    seedFromForm(config) {
      act(() => {
        state = progressReducer(state, {
          type: 'RESET_ALL',
          totals: computeTotalsFromConfig(config),
        });
      });
    },
    receive(frames) {
      frames.forEach((frame) =>
        act(() => {
          socket.onmessage({ data: frame });
        })
      );
    },
    /** The status poll the hook runs when it reconnects mid-run. */
    async rehydrate() {
      await act(async () => {
        socket.onopen();
      });
    },
    read: () => state,
  };
}

const bar = (entity, state) => ({
  completed: state[entity].completed,
  total: state[entity].total,
});

describe('a count keeps its meaning from the SDK to the dashboard (#800)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const FIFTY_PRODUCTS = {
    productCount: 50,
    accountCount: 0,
    orderCount: 0,
    imageMode: 'none',
    pdfMode: 'none',
    createWarehouses: false,
  };

  it('shows the fifty products five real batches actually placed', async () => {
    const service = startMicroservice({ config: FIFTY_PRODUCTS });
    const dashboard = openDashboard();
    dashboard.seedFromForm(FIFTY_PRODUCTS);

    await runStep(service, S.CREATE_PRODUCTS, [10, 10, 10, 10, 10]);

    dashboard.receive(service.frames);

    expect(bar('products', dashboard.read())).toEqual({
      completed: 50,
      total: 50,
    });
    expect(dashboard.read().products.isDone).toBe(true);
    expect(dashboard.read().completedSteps).toBe(1);
  });

  it('reads the count the microservice nests, not one it hoped for', () => {
    // `batchCompleted` puts its counts under `details` and sends no
    // `totalCount` at all. Both sides pass their own tests with either shape;
    // only a frame that crossed the boundary says which one is real.
    const service = startMicroservice();

    service.progress.batchCompleted({
      sessionId: SESSION_ID,
      batchERC: 'AICA-BATCH-1',
      batchId: '100',
      successCount: 10,
      failureCount: 0,
      entityType: 'products',
      operation: 'generate',
      correlationId: CORRELATION_ID,
    });

    const frame = JSON.parse(service.frames[0]);

    expect(frame.type).toBeUndefined();
    expect(frame.status).toBe('COMPLETED');
    expect(frame.successCount).toBeUndefined();
    expect(frame.details.successCount).toBe(10);
    expect(frame.totalCount).toBeUndefined();
  });

  it('keeps 38 of 50 when the AI delivered 38 and the run placed them all', async () => {
    // Nothing in the run reports 50 after the shortfall: only 38 items are
    // ever submitted, so every later figure is 38. The denominator survives
    // because the request seeded it and nothing may lower it (#756, #761).
    const service = startMicroservice({ config: FIFTY_PRODUCTS });
    const dashboard = openDashboard();
    dashboard.seedFromForm(FIFTY_PRODUCTS);

    await runStep(service, S.CREATE_PRODUCTS, [10, 10, 10, 8]);

    dashboard.receive(service.frames);

    expect(bar('products', dashboard.read())).toEqual({
      completed: 38,
      total: 50,
    });
    expect(dashboard.read().products.isDone).toBe(true);
  });

  it('does not let a step completion claim the work its batches did not do', async () => {
    // The step completion carries the total its batches attempted and no
    // processed count of its own. Filling the one from the other is what made
    // every step announce it had done all it was asked (#773), and it is
    // invisible from either side alone: the microservice's own test asserts
    // the payload it built, and the hook's tests assert a frame they wrote.
    const service = startMicroservice();
    const dashboard = openDashboard();

    const erc = await service.submitBatch(S.CREATE_ORDERS, 50, 300);
    // Liferay accepted the batch and processed 38 of the 50 items in it.
    await service.completeBatch(erc, 300, { processed: 38, total: 50 });

    await service.generator.completeSyncStep(
      SESSION_ID,
      S.CREATE_ORDERS,
      'COMPLETED'
    );

    dashboard.receive(service.frames);

    expect(bar('orders', dashboard.read())).toEqual({
      completed: 38,
      total: 50,
    });
  });
});

describe('the live bar and the rehydrated bar count the same run (#891)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Seven products, one batch each, then one batch per price list - the row
   * shape a real seven-product import wrote. Summing the work against the size
   * of a single batch reported `skus 7/1` and `priceLists 57/47` on a run
   * where every entity was correct (#891).
   */
  const runSevenProductImport = async (service, options) => {
    await runStep(service, S.CREATE_PRODUCTS, [1, 1, 1, 1, 1, 1, 1], options);
    await runStep(
      service,
      S.CREATE_PRODUCT_SKUS,
      [1, 1, 1, 1, 1, 1, 1],
      options
    );
    await runStep(service, S.GENERATE_PRICE_LISTS, [47, 10], options);
  };

  const CONFIG = {
    productCount: 7,
    accountCount: 0,
    orderCount: 0,
    imageMode: 'none',
    pdfMode: 'none',
    createWarehouses: false,
  };

  it('agrees on every bar, whether the dashboard watched or reconnected', async () => {
    const service = startMicroservice({ config: CONFIG });
    await runSevenProductImport(service);

    const watching = openDashboard();
    watching.seedFromForm(CONFIG);
    watching.receive(service.frames);

    const summary = summariseSessionProgress({
      batches: service.batches(),
      options: CONFIG,
    });

    const reconnecting = openDashboard({
      statusResponse: {
        success: true,
        status: 'RUNNING',
        flowType: 'generate',
        progress: summary,
      },
    });
    reconnecting.seedFromForm(CONFIG);
    await reconnecting.rehydrate();

    ['products', 'skus', 'priceLists'].forEach((entity) => {
      expect([entity, bar(entity, reconnecting.read())]).toEqual([
        entity,
        bar(entity, watching.read()),
      ]);
    });

    expect(bar('skus', watching.read())).toEqual({ completed: 7, total: 7 });
    expect(bar('priceLists', watching.read())).toEqual({
      completed: 57,
      total: 57,
    });
  });

  it('reports the same bars when every callback beats the next submit', async () => {
    // The `skus 7/1` the dashboard displayed on a wholly successful run
    // (#891). Seven batches of one item, each finishing before the next was
    // submitted, and a denominator that only ever held the batches in flight
    // at once.
    const service = startMicroservice({ config: CONFIG });
    await runSevenProductImport(service, { interleaved: true });

    const dashboard = openDashboard();
    dashboard.seedFromForm(CONFIG);
    dashboard.receive(service.frames);

    expect(bar('skus', dashboard.read())).toEqual({ completed: 7, total: 7 });
    expect(bar('priceLists', dashboard.read())).toEqual({
      completed: 57,
      total: 57,
    });
  });

  it('asks for the same amounts on both sides of the request', () => {
    // The dashboard seeds its bars from the operator's form and the status
    // route seeds its own from the options that form submitted. Two
    // implementations of "what was asked for", one on each side of the wire,
    // and a bar is only a fraction while they agree.
    const config = {
      productCount: '50',
      accountCount: '12',
      orderCount: '8',
      imageMode: 'placeholder',
      imageRatio: 40,
      pdfMode: 'placeholder',
      pdfRatio: 100,
      createWarehouses: true,
      warehouseCount: '3',
    };

    const fromDashboard = computeTotalsFromConfig(config);
    const fromStatusRoute = summariseSessionProgress({
      batches: [],
      options: config,
    });

    Object.entries(fromDashboard).forEach(([entity, total]) => {
      expect([entity, fromStatusRoute[entity].total]).toEqual([entity, total]);
    });
  });
});

describe('a step that only advanced the workflow reports no work (#799)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts no count on the wire and writes no count to the row', async () => {
    // `submitBatch` schedules one of these markers for every batch Liferay
    // reports as already complete, and a bypassed step writes another. While
    // their counts defaulted to 1, four markers behind five inventory batches
    // put a `1` on the wire that #776 had taught the dashboard to believe,
    // and inflated the step's persisted total from 139 to 143 (#799).
    const service = startMicroservice();

    await service.generator.completeSyncStep(
      SESSION_ID,
      S.UPDATE_INVENTORY,
      'COMPLETED'
    );

    const frame = JSON.parse(service.frames[0]);

    expect(frame.scope).toBe('step');
    expect(frame.status).toBe('COMPLETED');
    expect(frame.entityType).toBe('inventory');
    expect(frame).not.toHaveProperty('processedCount');
    expect(frame).not.toHaveProperty('totalCount');

    expect(service.batches()).toEqual([
      expect.objectContaining({
        step_key: S.UPDATE_INVENTORY,
        processed_count: null,
        total_count: null,
      }),
    ]);
  });

  it('leaves the 139 items five batches proved, behind four markers', async () => {
    const service = startMicroservice();
    const dashboard = openDashboard();

    await runStep(service, S.UPDATE_INVENTORY, [30, 30, 30, 30, 19]);

    for (let index = 0; index < 4; index += 1) {
      await service.generator.completeSyncStep(
        SESSION_ID,
        S.UPDATE_INVENTORY,
        'COMPLETED'
      );
    }

    dashboard.receive(service.frames);

    expect(bar('inventory', dashboard.read())).toEqual({
      completed: 139,
      total: 139,
    });
  });
});
