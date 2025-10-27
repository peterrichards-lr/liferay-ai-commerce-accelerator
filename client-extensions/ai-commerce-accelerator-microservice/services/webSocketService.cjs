const WebSocket = require('ws');
const {
  BATCH_START,
  BATCH_PROGRESS,
  GENERATION_SESSION_COMPLETE,
  POSTPROC_COMPLETED,
  POSTPROC_PROGRESS,
  POSTPROC_STARTED,
  SESSION_COMPLETE,
  BATCH_COMPLETED,
  BATCH_FAILED,
  BATCH_SUBSCRIPTION_CONFIRMED,
  GENERATION_PROGRESS,
} = require('../utils/wsEvents.cjs');
const { CORRELATION_ID_HEADER } = require('../utils/sharedConstants.cjs');
const { delay, safeJSON, isoNow } = require('../utils/misc.cjs');

function normalizeRetries(retries) {
  if (!retries) return [];
  if (Array.isArray(retries)) return retries;
  const n = Math.max(0, Number(retries) || 0);
  return Array.from({ length: n }, () => 500);
}

function createWebSocketService({
  server,
  logger = console,
  heartbeatIntervalMs = 30000,
} = {}) {
  if (!server) throw new Error('webSocketService requires an HTTP server');

  const wss = new WebSocket.Server({ server });
  const clients = new Map();
  const byBatch = new Map();

  function resolveTargets({ mode = 'auto', correlationId, batchId }, payload) {
    // prefer explicit, otherwise infer from payload
    const cid = correlationId ?? payload?.correlationId;
    const bid = batchId ?? payload?.batchId;

    if (mode === 'unicast' || (mode === 'auto' && cid)) {
      const c = clients.get(cid);
      return c ? [c] : [];
    }

    if (mode === 'batch' || (mode === 'auto' && bid && byBatch.has(bid))) {
      return byBatch.get(bid) || [];
    }

    // broadcast (default)
    return clients;
  }

  function sendOnce(packet, targets) {
    let sent = 0,
      open = 0,
      errors = 0;
    for (const ws of targets) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      open++;
      try {
        ws.send(packet);
        sent++;
      } catch {
        errors++;
      }
    }
    return { sent, open, errors };
  }

  function deliver(message, opts = {}) {
    const {
      mode = 'auto', // 'auto' | 'unicast' | 'batch' | 'broadcast'
      correlationId,
      batchId,
      retries = [300, 1500],
      fireAndForget = false,
      onAttempt, // (attemptIndex, result) => void
    } = opts;

    const packet = safeJSON(message);
    const schedule = normalizeRetries(retries);

    const run = async () => {
      const targets = resolveTargets({ mode, correlationId, batchId }, message);
      logger?.trace?.(
        `ws:send -> mode=${mode} cid=${correlationId ?? '∅'} bid=${
          batchId ?? '∅'
        } targets=${targets.length}`
      );

      let last = sendOnce(packet, targets);
      onAttempt?.(0, last);
      for (let i = 0; i < schedule.length; i++) {
        if (last.sent > 0) break;
        await delay(schedule[i]);
        const retryTargets = resolveTargets(
          { mode, correlationId, batchId },
          message
        );
        last = sendOnce(packet, retryTargets);
        onAttempt?.(i + 1, last);
      }
      return { attempts: schedule.length + 1, last };
    };

    if (fireAndForget) {
      run().catch((e) =>
        logger?.warn?.('ws:fire-and-forget error', { error: e?.message })
      );
      return;
    }
    return run();
  }

  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const correlationId = url.searchParams.get(CORRELATION_ID_HEADER) || null;
      ws.id = correlationId;
      ws.correlationId = correlationId;
    } catch {
      logger.warn('Unable to attach the correlation Id to the web socket');
    }
    ws.isAlive = true;
    ws.url = req.headers.origin;
    ws.ip = req.socket.remoteAddress;
    clients.set(ws.correlationId, ws);

    logger?.info?.('WebSocket connection', {
      operation: 'websocket-connect',
      clientIP: req?.socket?.remoteAddress,
      id: ws.id,
      connectedClients: clients.size,
      correlationId: ws.correlationId,
    });

    // Health
    ws.on('pong', () => (ws.isAlive = true));

    // Messages from client
    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString('utf8'));
      } catch {
        deliver(ws, { type: 'error', message: 'Invalid message format' });
        return;
      }

      switch (msg?.type) {
        case 'ping':
          deliver(ws, { type: 'pong', seq: msg.seq, timestamp: isoNow() });
          break;

        case 'subscribe-batch': {
          const batchId = msg?.payload?.batchId;
          if (!batchId) break;
          ws.__batchId = batchId;
          let set = byBatch.get(batchId);
          if (!set) byBatch.set(batchId, (set = new Set()));
          set.add(ws);
          deliver(ws, {
            type: BATCH_SUBSCRIPTION_CONFIRMED,
            batchId,
            timestamp: isoNow(),
          });
          break;
        }

        case 'unsubscribe-batch': {
          const batchId = ws.__batchId;
          if (!batchId) break;
          const set = byBatch.get(batchId);
          if (set) {
            set.delete(ws);
            if (set.size === 0) byBatch.delete(batchId);
          }
          ws.__batchId = null;
          break;
        }

        default:
          deliver(ws, {
            type: 'error',
            message: `Unknown message type: ${msg?.type}`,
            timestamp: isoNow(),
          });
      }
    });

    ws.on('close', (code, reason) => {
      clients.delete(ws);
      if (ws.__batchId) {
        const set = byBatch.get(ws.__batchId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) byBatch.delete(ws.__batchId);
        }
      }
      logger?.info?.('WebSocket closed', {
        operation: 'websocket-disconnect',
        id: ws.id,
        code,
        reason: reason ? reason.toString() : '',
        remainingClients: clients.size,
      });
    });

    ws.on('error', (error) => {
      logger?.error?.('WebSocket error', {
        operation: 'websocket-error',
        id: ws.id,
        error: error?.message,
      });
    });

    // greet
    deliver(ws, { type: 'connected', timestamp: isoNow() });
  });

  // Health check loop
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        logger?.warn?.('Terminating unresponsive WS', {
          operation: 'websocket-health-check',
          id: ws.id,
        });
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {}
      }
    }
  }, heartbeatIntervalMs);

  async function emit(message, opts = {}) {
    return deliver(message, opts);
  }

  const emitBatchStarted = (
    { batchId, entityType, details = {}, correlationId },
    opts = {}
  ) => {
    const payload = {
      type: BATCH_START,
      entityType,
      details: {
        ...details,
        batchId,
      },
      timestamp: isoNow(),
    };

    return emit(payload, { ...opts, batchId, correlationId });
  };

  const emitBatchProgress = (
    {
      batchId,
      entityType,
      completedCount,
      totalItems,
      correlationId,
      progress,
      details = {},
    },
    opts = {}
  ) => {
    const payload = {
      type: BATCH_PROGRESS,

      entityType,
      details: {
        ...details,
        batchId,
        completedCount,
        totalItems,
        progress,
      },
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, batchId, correlationId });
  };

  const emitBatchCompleted = (
    {
      batchId,
      entityType,
      successCount,
      failureCount = 0,
      correlationId,
      errors = [],
      details = {},
    },
    opts = {}
  ) => {
    const payload = {
      type: BATCH_COMPLETED,
      entityType,
      details: {
        ...details,
        batchId,
        successCount,
        failureCount,
        errors,
      },
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, batchId, correlationId });
  };

  const emitSessionCompleted = (
    { entityType, correlationId, details = {} },
    opts = {}
  ) => {
    const payload = { type: SESSION_COMPLETE, entityType, details, timestamp };
    return emit(payload, { ...opts, correlationId });
  };

  const emitPostProcessingStarted = (
    { entityType, correlationId, details = {} },
    opts = {}
  ) => {
    const payload = {
      type: POSTPROC_STARTED,
      entityType,
      details,
      timestamp: isoNow(),
    };

    return emit(payload, { ...opts, correlationId });
  };

  const emitPostProcessingProgress = (
    {
      entityType,
      processedCount,
      totalCount,
      correlationId,
      progress,
      details = {},
    },
    opts = {}
  ) => {
    const payload = {
      type: POSTPROC_PROGRESS,
      entityType,
      details: { ...details, processedCount, totalCount, progress },
      timestamp: isoNow(),
    };

    return emit(payload, { ...opts, batchId, correlationId });
  };

  const emitPostProcessingCompleted = (
    {
      entityType,
      processedCount,
      totalCount,
      errorCount = 0,
      correlationId,
      errors = [],
      details = {},
    },
    opts = {}
  ) => {
    const payload = {
      type: POSTPROC_COMPLETED,
      entityType,
      details: { ...details, processedCount, totalCount, errorCount, errors },
      timestamp: isoNow(),
    };

    return emit(payload, { ...opts, batchId, correlationId });
  };

  const emitGenerationSessionComplete = (
    { correlationId, sessionId, details = {} },
    opts = {}
  ) => {
    const payload = {
      type: GENERATION_SESSION_COMPLETE,
      details,
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, sessionId, correlationId });
  };

  const emitGenerationProgress = (
    {
      percent,
      message,
      phase,
      batchId,
      correlationId,
      entityType,
      details = {},
    },
    opts = {}
  ) => {
    const payload = {
      type: GENERATION_PROGRESS,
      entityType,
      details: { ...details, percent, message, phase, batchId },
      timestamp: isoNow(),
    };

    return emit(payload, { ...opts, batchId, correlationId });
  };

  const emitBatchFailed = (
    {
      batchId,
      entityType,
      error,
      successCount = 0,
      failureCount = 0,
      correlationId,
      details = {},
    },
    opts = {}
  ) => {
    const payload = {
      type: BATCH_FAILED,
      entityType,
      details: {
        ...details,
        error,
        successCount,
        failureCount,
        batchId,
      },
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, batchId, correlationId });
  };

  const stop = () => {
    clearInterval(heartbeat);
    for (const ws of clients) {
      try {
        if (ws.readyState === WebSocket.OPEN)
          ws.close(1001, 'Server shutting down');
      } catch {}
    }
    try {
      wss.close();
    } catch {}
  };

  const clientCount = () => {
    return clients.size || 0;
  };

  return {
    clientCount,
    emitBatchStarted,
    emitBatchProgress,
    emitBatchCompleted,
    emitSessionCompleted,
    emitPostProcessingStarted,
    emitPostProcessingProgress,
    emitPostProcessingCompleted,
    emitGenerationSessionComplete,
    emitGenerationProgress,
    emitBatchFailed,
    stop,
  };
}

module.exports = { createWebSocketService };
