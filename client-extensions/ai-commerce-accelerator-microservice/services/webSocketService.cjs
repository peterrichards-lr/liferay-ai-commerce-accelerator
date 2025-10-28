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

function isWebSocketInstance(x) {
  return x && typeof x === 'object' && typeof x.send === 'function' && typeof x.close === 'function';
}

function countIterable(iter) {
  if (!iter) return 0;
  if (Array.isArray(iter)) return iter.length;
  if (iter instanceof Set) return iter.size;
  if (iter instanceof Map) return iter.size;
  let n = 0;
  for (const _ of iter) n++;
  return n;
}

function normalizeRetries(retries) {
  if (!retries) return [];
  if (Array.isArray(retries)) return retries;
  const n = Math.max(0, Number(retries) || 0);
  return Array.from({ length: n }, () => 500);
}

function withOperation(details = {}, operation) {
  const op = operation ?? details.operation;
  return op ? { ...details, operation: op } : details;
}

function normalizeBid(b) {
  if (b === undefined || b === null) return null;
  const s = String(b);
  return s.length ? s : null;
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
  const lastCompletion = new Map(); // Map<batchIdStr, { success, failure, total }>

  function resolveTargets({ mode = 'auto', correlationId, batchId }, payload) {
    const cid = correlationId ?? payload?.correlationId ?? null;
    const bid = normalizeBid(batchId ?? payload?.batchId);

    if (mode === 'unicast' || (mode === 'auto' && cid)) {
      const c = clients.get(cid);
      return c ? [c] : [];
    }
    if (mode === 'batch' || (mode === 'auto' && bid && byBatch.has(bid))) {
      return byBatch.get(bid) || [];
    }
    return clients.values();
  }

  function sendOnce(packet, targets) {
    let sent = 0, open = 0, errors = 0;
    for (const ws of targets) {
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
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
      mode = 'auto',
      correlationId,
      batchId,
      retries = [300, 1500],
      fireAndForget = false,
      onAttempt,
    } = opts;

    if (isWebSocketInstance(message)) {
      const stack = new Error().stack?.split('\n').slice(2, 4).join(' ← ');
      logger?.warn?.('⚠️  Attempted to broadcast a WebSocket instance', {
        operation: 'websocket-send-guard',
        hint: 'First argument must be a plain message object, not a ws connection',
        stackSnippet: stack,
      });
      return;
    }

    const bid = normalizeBid(batchId ?? message?.batchId);
    const packet = safeJSON(bid ? { ...message, batchId: bid } : message);
    const schedule = normalizeRetries(retries);

    const run = async () => {
      const targets = resolveTargets({ mode, correlationId, batchId: bid }, message);
      const targetCount = countIterable(targets);
      const msgType = message?.type ?? '(no-type)';

      logger?.trace?.(
        `[ws:send] type=${msgType} mode=${mode} cid=${correlationId ?? '∅'} bid=${bid ?? '∅'} → ${targetCount} target(s)`
      );

      if (!message?.type) {
        logger?.warn?.('🟡 WebSocket message missing "type" property', {
          operation: 'websocket-missing-type',
          payloadKeys: Object.keys(message || {}),
        });
      }

      let last = sendOnce(packet, targets);
      onAttempt?.(0, last);
      for (let i = 0; i < schedule.length; i++) {
        if (last.sent > 0) break;
        await delay(schedule[i]);
        const retryTargets = resolveTargets({ mode, correlationId, batchId: bid }, message);
        last = sendOnce(packet, retryTargets);
        onAttempt?.(i + 1, last);
      }
      return { attempts: schedule.length + 1, last };
    };

    if (fireAndForget) {
      run().catch((e) => logger?.warn?.('ws:fire-and-forget error', { error: e?.message }));
      return;
    }

    return run().then((res) => {
      const t = message?.type ?? '(unknown)';
      logger?.trace?.(
        `[ws:sent] type=${t} cid=${correlationId ?? '∅'} bid=${bid ?? '∅'} attempts=${res.attempts} sent=${res.last.sent}/${res.last.open} errors=${res.last.errors}`
      );
      return { sent: res.last.sent, failed: res.last.errors, totalClients: clientCount() };
    });
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

    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString('utf8'));
      } catch {
        deliver(
          { type: 'error', message: 'Invalid message format', timestamp: isoNow() },
          { mode: 'unicast', correlationId: ws.correlationId, fireAndForget: true }
        );
        return;
      }

      switch (msg?.type) {
        case 'ping':
          deliver(
            { type: 'pong', seq: msg.seq, timestamp: isoNow() },
            { mode: 'unicast', correlationId: ws.correlationId, fireAndForget: true }
          );
          break;

        case 'subscribe-batch': {
          const batchId = normalizeBid(msg?.payload?.batchId);
          if (!batchId) break;
          ws.__batchId = batchId;
          let set = byBatch.get(batchId);
          if (!set) byBatch.set(batchId, (set = new Set()));
          set.add(ws);
          deliver(
            { type: BATCH_SUBSCRIPTION_CONFIRMED, batchId, timestamp: isoNow() },
            { mode: 'unicast', correlationId: ws.correlationId, fireAndForget: true }
          );
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
          deliver(
            { type: 'error', message: `Unknown message type: ${msg?.type}`, timestamp: isoNow() },
            { mode: 'unicast', correlationId: ws.correlationId, fireAndForget: true }
          );
      }
    });

    ws.on('close', (code, reason) => {
      clients.delete(ws.correlationId);
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
      if (code !== 1001 && code !== 1000) {
        logger?.warn?.('⚠️  Abnormal WS closure', {
          code,
          reason: reason ? reason.toString() : '(no reason)',
          correlationId: ws.correlationId,
        });
      }
    });

    ws.on('error', (error) => {
      logger?.error?.('WebSocket error', {
        operation: 'websocket-error',
        id: ws.id,
        error: error?.message,
      });
    });

    deliver(
      { type: 'connected', timestamp: isoNow() },
      { mode: 'unicast', correlationId: ws.correlationId, fireAndForget: true }
    );
  });

  const heartbeat = setInterval(() => {
    let checked = 0, terminated = 0;
    for (const ws of clients.values()) {
      checked++;
      if (ws.isAlive === false) {
        terminated++;
        logger?.warn?.('🧹 Terminating unresponsive WS', {
          operation: 'websocket-health-check',
          id: ws.id,
        });
        try { ws.terminate(); } catch {}
        continue;
      }
      ws.isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch {}
      }
    }
    logger?.trace?.(`[ws:heartbeat] checked=${checked} terminated=${terminated}`);
  }, heartbeatIntervalMs);

  async function emit(message, opts = {}) {
    const res = await deliver(message, opts);
    return res && typeof res === 'object'
      ? { sent: res.sent ?? 0, failed: res.failed ?? 0, totalClients: clientCount() }
      : { sent: 0, failed: 0, totalClients: clientCount() };
  }

  const emitBatchStarted = (
    { batchId, entityType, details = {}, correlationId, operation },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const totalCount = details.totalCount ?? details.totalItems ?? details.expectedTotal;
    const payload = {
      type: BATCH_START,
      operation,
      entityType,
      batchId: bid,
      details: withOperation({ ...details, batchId: bid, totalCount }, operation),
      totalCount,
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, batchId: bid, correlationId });
  };

  const emitBatchProgress = (
    { batchId, entityType, completedCount, totalItems, correlationId, progress, details = {}, operation },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const processedCount = details.processedCount ?? details.completedCount ?? completedCount ?? 0;
    const totalCount = details.totalCount ?? totalItems ?? details.expectedTotal ?? undefined;
    const payload = {
      type: BATCH_PROGRESS,
      operation,
      entityType,
      batchId: bid,
      processedCount,
      totalCount,
      details: withOperation(
        {
          ...details,
          batchId: bid,
          processedCount,
          completedCount: processedCount,
          totalCount,
          totalItems: totalCount,
          progress,
        },
        operation
      ),
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, batchId: bid, correlationId });
  };

  const emitBatchCompleted = (
    { batchId, entityType, successCount = 0, failureCount = 0, totalCount, correlationId, errors = [], details = {}, operation },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const normalizedTotal =
      details.totalCount ??
      totalCount ??
      (Number.isFinite(successCount) && Number.isFinite(failureCount) ? successCount + failureCount : undefined);

    const sumSF = (Number(successCount) || 0) + (Number(failureCount) || 0);
    const isEmpty = sumSF === 0 && !Number.isFinite(normalizedTotal);
    if (isEmpty) {
      logger?.trace?.(`[ws:drop] empty batch_completed (no totals) for ${bid ?? '(null)'}`);
      return Promise.resolve({ sent: 0, failed: 0, totalClients: clientCount() });
    }

    const prev = bid ? lastCompletion.get(bid) : null;
    const prevTotal = prev ? ((Number(prev.success) || 0) + (Number(prev.failure) || 0)) : -1;
    if (prev && prevTotal > sumSF) {
      logger?.trace?.(`[ws:drop] worse duplicate batch_completed for ${bid}`);
      return Promise.resolve({ sent: 0, failed: 0, totalClients: clientCount() });
    }

    const payload = {
      type: BATCH_COMPLETED,
      operation,
      entityType,
      batchId: bid,
      successCount,
      failureCount,
      totalCount: normalizedTotal,
      details: withOperation(
        { ...details, batchId: bid, successCount, failureCount, totalCount: normalizedTotal, errors },
        operation
      ),
      timestamp: isoNow(),
    };

    lastCompletion.set(bid, {
      success: Number(successCount) || 0,
      failure: Number(failureCount) || 0,
      total: Number(normalizedTotal) || sumSF,
    });

    return emit(payload, { ...opts, batchId: bid, correlationId });
  };

  const emitSessionCompleted = (
    { entityType, correlationId, details = {}, operation },
    opts = {}
  ) => {
    const payload = {
      type: SESSION_COMPLETE,
      operation,
      entityType,
      details: withOperation(details, operation),
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, correlationId });
  };

  const emitPostProcessingStarted = (
    { entityType, correlationId, details = {}, operation },
    opts = {}
  ) => {
    const payload = {
      type: POSTPROC_STARTED,
      operation,
      entityType,
      details: withOperation(details, operation),
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, correlationId });
  };

  const emitPostProcessingProgress = (
    { entityType, processedCount, totalCount, correlationId, progress, details = {}, operation },
    opts = {}
  ) => {
    const payload = {
      type: POSTPROC_PROGRESS,
      operation,
      entityType,
      details: withOperation({ ...details, processedCount, totalCount, progress }, operation),
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, correlationId });
  };

  const emitPostProcessingCompleted = (
    { entityType, processedCount, totalCount, errorCount = 0, correlationId, errors = [], details = {}, operation },
    opts = {}
  ) => {
    const payload = {
      type: POSTPROC_COMPLETED,
      operation,
      entityType,
      details: withOperation({ ...details, processedCount, totalCount, errorCount, errors }, operation),
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, correlationId });
  };

  const emitGenerationSessionComplete = (
    { correlationId, sessionId, details = {}, operation },
    opts = {}
  ) => {
    const payload = {
      type: GENERATION_SESSION_COMPLETE,
      operation,
      details: withOperation({ ...details, sessionId }, operation),
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, correlationId });
  };

  const emitGenerationProgress = (
    { percent, message, phase, batchId, correlationId, entityType, details = {}, operation },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const payload = {
      type: GENERATION_PROGRESS,
      operation,
      entityType,
      batchId: bid,
      details: withOperation({ ...details, percent, message, phase, batchId: bid }, operation),
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, batchId: bid, correlationId });
  };

  const emitBatchFailed = (
    { batchId, entityType, error, successCount = 0, failureCount = 0, correlationId, details = {}, operation },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const totalCount =
      details.totalCount ??
      (Number.isFinite(successCount) && Number.isFinite(failureCount) ? successCount + failureCount : undefined);

    const payload = {
      type: BATCH_FAILED,
      operation,
      entityType,
      batchId: bid,
      successCount,
      failureCount,
      totalCount,
      details: withOperation({ ...details, error, successCount, failureCount, batchId: bid, totalCount }, operation),
      timestamp: isoNow(),
    };
    return emit(payload, { ...opts, batchId: bid, correlationId });
  };

  const stop = () => {
    clearInterval(heartbeat);
    for (const ws of clients.values()) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close(1001, 'Server shutting down');
      } catch {}
    }
    try { wss.close(); } catch {}
  };

  const clientCount = () => clients.size || 0;
  const totalClients = () => clientCount();

  return {
    clientCount,
    totalClients,
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