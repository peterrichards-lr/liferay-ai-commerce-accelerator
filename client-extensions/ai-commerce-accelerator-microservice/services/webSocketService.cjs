const WebSocket = require('ws');
const { CORRELATION_ID_HEADER } = require('../utils/sharedConstants.cjs');
const {
  delay,
  safeJSON,
  isoNow,
  normalizeNumber,
  tryParseJSON,
  createERC,
} = require('../utils/misc.cjs');
const {
  ENV,
  ERC_PREFIX,
  WEB_SOCKET_EVENTS,
} = require('../utils/constants.cjs');

function withErrorRef(err, operation) {
  if (err && err.errorReference) return err;
  const wrapped =
    err instanceof Error ? err : new Error(String(err || 'Error'));
  wrapped.errorReference = createERC(ERC_PREFIX.ERROR);
  wrapped.operation = operation;
  return wrapped;
}

function isWebSocketInstance(x) {
  return (
    x &&
    typeof x === 'object' &&
    typeof x.send === 'function' &&
    typeof x.close === 'function'
  );
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

function normalizeBid(b) {
  if (b === undefined || b === null) return null;
  const s = String(b);
  return s.length ? s : null;
}

function withOperation(details = {}, operation) {
  const op = operation ?? details.operation;
  return op ? { ...details, operation: op } : details;
}

function createWebSocketService({
  server,
  logger = console,
  heartbeatIntervalMs,
  retryIntervalMs,
  maxRetries,
  configService,
} = {}) {
  if (!server) throw new Error('webSocketService requires an HTTP server');

  const defaults = {
    heartbeatIntervalMs: normalizeNumber(
      heartbeatIntervalMs ?? ENV.WS_HEARTBEAT_MS,
      { min: 5000, defaultValue: 30000 }
    ),
    retryIntervalMs: normalizeNumber(
      retryIntervalMs ?? ENV.WS_RETRY_INTERVAL_MS,
      { min: 100, defaultValue: 500 }
    ),
    maxRetries: normalizeNumber(maxRetries ?? ENV.WS_MAX_RETRIES, {
      min: 0,
      defaultValue: 3,
    }),
  };

  const state = {
    heartbeatIntervalMs: defaults.heartbeatIntervalMs,
    retryIntervalMs: defaults.retryIntervalMs,
    maxRetries: defaults.maxRetries,
  };

  const wss = new WebSocket.Server({ server });

  const clients = new Map();
  const byBatch = new Map();
  const lastCompletion = new Map();

  let heartbeatTimer;

  function _heartbeatTick() {
    let checked = 0;
    let terminated = 0;

    for (const ws of clients.values()) {
      checked++;

      if (ws.isAlive === false) {
        terminated++;
        logger?.warn?.('Terminating unresponsive WS', {
          operation: 'websocket-health-check',
          id: ws.id,
          correlationId: ws.correlationId,
        });
        try {
          ws.terminate();
        } catch (_) {}
        continue;
      }

      ws.isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch (_) {}
      }
    }

    logger?.trace?.(
      `[ws:heartbeat] checked=${checked} terminated=${terminated}`
    );
  }

  function applyWsConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;

    const next = {
      heartbeatIntervalMs: normalizeNumber(cfg.heartbeatIntervalMs, {
        min: 5000,
        defaultValue: defaults.heartbeatIntervalMs,
      }),
      retryIntervalMs: normalizeNumber(cfg.retryIntervalMs, {
        min: 100,
        defaultValue: defaults.retryIntervalMs,
      }),
      maxRetries: normalizeNumber(cfg.maxRetries, {
        min: 0,
        defaultValue: defaults.maxRetries,
      }),
    };

    state.heartbeatIntervalMs = Math.max(
      defaults.heartbeatIntervalMs,
      next.heartbeatIntervalMs
    );
    state.retryIntervalMs = Math.max(
      defaults.retryIntervalMs,
      next.retryIntervalMs
    );
    state.maxRetries = Math.max(defaults.maxRetries, next.maxRetries);

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(_heartbeatTick, state.heartbeatIntervalMs);
    }

    logger?.debug?.('WS config applied', {
      operation: 'ws-config-apply',
      heartbeatIntervalMs: state.heartbeatIntervalMs,
      retryIntervalMs: state.retryIntervalMs,
      maxRetries: state.maxRetries,
    });
  }

  async function refreshWsConfigFromRemote(requestConfig) {
    const op = 'ws-config-refresh';
    if (!configService?.getWSConfig) return;
    try {
      const remote = await configService.getWSConfig(requestConfig);
      applyWsConfig(remote);
    } catch (e) {
      const error = withErrorRef(e, op);
      logger?.warn?.('WS: failed to refresh ws-config from remote', {
        operation: op,
        errorReference: error.errorReference,
        message: error.message,
      });
    }
  }

  if (configService?.getWSConfigCached) {
    try {
      const cached = configService.getWSConfigCached();
      applyWsConfig(cached);
    } catch (e) {
      const error = withErrorRef(e, 'ws-config-cached-apply');
      logger?.warn?.('WS: failed to apply cached ws-config', {
        operation: 'ws-config-cached-apply',
        errorReference: error.errorReference,
        message: error.message,
      });
    }
  }

  heartbeatTimer = setInterval(_heartbeatTick, state.heartbeatIntervalMs);

  function resolveTargets(
    { mode = 'auto', correlationId, batchId, sessionId },
    payload
  ) {
    const cid = correlationId ?? payload?.correlationId ?? null;
    const bid = normalizeBid(batchId ?? payload?.batchId);
    const sid = sessionId ?? payload?.sessionId ?? null;

    // Highest Priority: sessionId (most stable across callbacks)
    if (sid) {
      const targets = Array.from(clients.values()).filter(
        (ws) => ws.sessionId === sid
      );
      if (targets.length > 0) return targets;
    }

    // Second Priority: correlationId
    if (mode === 'unicast' || (mode === 'auto' && cid)) {
      const c = clients.get(cid);
      if (c) return [c];
      return [];
    }

    if (mode === 'batch' || (mode === 'auto' && bid && byBatch.has(bid))) {
      return byBatch.get(bid) || [];
    }

    return clients.values();
  }

  function sendOnce(packet, targets) {
    let sent = 0;
    let open = 0;
    let errors = 0;

    for (const ws of targets) {
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      open++;
      try {
        ws.send(packet);
        sent++;
      } catch (_) {
        errors++;
      }
    }

    return { sent, open, errors };
  }

  function retrySchedule() {
    const n = Math.max(0, Number(state.maxRetries) || 0);
    const step = Math.max(100, Number(state.retryIntervalMs) || 500);
    return Array.from({ length: n }, () => step);
  }

  function deliver(message, opts = {}) {
    const {
      mode = 'auto',
      correlationId,
      batchId,
      retries,
      fireAndForget = false,
      onAttempt,
    } = opts;

    if (isWebSocketInstance(message)) {
      const stack = new Error().stack?.split('\n').slice(2, 4).join(' ← ');
      logger?.warn?.('Attempted to broadcast a WebSocket instance', {
        operation: 'ws-deliver-guard',
        hint: 'First argument must be a plain message object, not a ws connection',
        stackSnippet: stack,
      });
      return;
    }

    const bid = normalizeBid(batchId ?? message?.batchId);
    const sid = opts.sessionId ?? message?.sessionId ?? null;
    const packet = safeJSON(bid ? { ...message, batchId: bid } : message);
    const schedule = Array.isArray(retries) ? retries : retrySchedule();

    const run = async () => {
      const targets = resolveTargets(
        { mode, correlationId, batchId: bid, sessionId: sid },
        message
      );
      const targetCount = countIterable(targets);
      const msgType = message?.type ?? '(no-type)';
      const logCID = correlationId ?? message?.correlationId ?? '∅';

      logger?.trace?.(
        `[ws:send] type=${msgType} mode=${mode} cid=${logCID} bid=${
          bid ?? '∅'
        } → ${targetCount} target(s)`
      );

      if (!message?.type) {
        logger?.warn?.('WebSocket message missing "type" property', {
          operation: 'ws-deliver-missing-type',
          payloadKeys: Object.keys(message || {}),
        });
      }

      let last = sendOnce(packet, targets);
      onAttempt?.(0, last);

      for (let i = 0; i < schedule.length; i++) {
        if (last.sent > 0) break;
        await delay(schedule[i]);
        const retryTargets = resolveTargets(
          { mode, correlationId, batchId: bid, sessionId: sid },
          message
        );
        last = sendOnce(packet, retryTargets);
        onAttempt?.(i + 1, last);
      }

      return { attempts: schedule.length + 1, last };
    };

    if (fireAndForget) {
      run().catch((e) => {
        const error = withErrorRef(e, 'ws-fire-and-forget');
        logger?.warn?.('ws:fire-and-forget error', {
          operation: 'ws-fire-and-forget',
          errorReference: error.errorReference,
          message: error.message,
        });
      });
      return;
    }

    return run()
      .then((res) => {
        const t = message?.type ?? '(unknown)';
        const logCID = correlationId ?? message?.correlationId ?? '∅';
        logger?.trace?.(
          `[ws:sent] type=${t} cid=${logCID} bid=${
            bid ?? '∅'
          } attempts=${res.attempts} sent=${res.last.sent}/${
            res.last.open
          } errors=${res.last.errors}`
        );

        return {
          sent: res.last.sent,
          failed: res.last.errors,
          totalClients: clientCount(),
        };
      })
      .catch((e) => {
        const error = withErrorRef(e, 'ws-deliver-run');
        logger?.error?.('Error delivering WebSocket message', {
          operation: 'ws-deliver-run',
          errorReference: error.errorReference,
          message: error.message,
        });
        return {
          sent: 0,
          failed: 1,
          totalClients: clientCount(),
        };
      });
  }

  async function emit(message, opts = {}) {
    const res = await deliver(message, opts);
    return res && typeof res === 'object'
      ? {
          sent: res.sent ?? 0,
          failed: res.failed ?? 0,
          totalClients: clientCount(),
        }
      : { sent: 0, failed: 0, totalClients: clientCount() };
  }

  wss.on('connection', (ws, req) => {
    logger?.debug?.('WS connection attempt', {
      operation: 'websocket-connection-attempt',
      clientIP: req?.socket?.remoteAddress,
    });
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const correlationId = url.searchParams.get(CORRELATION_ID_HEADER) || null;
      const sessionId = url.searchParams.get('sessionId') || null;
      ws.id = correlationId;
      ws.correlationId = correlationId;
      ws.sessionId = sessionId;
    } catch (e) {
      const error = withErrorRef(e, 'ws-attach-correlation');
      logger?.warn?.('Unable to attach properties to the WebSocket', {
        operation: 'ws-attach-properties',
        errorReference: error.errorReference,
        message: error.message,
      });
    }

    ws.isAlive = true;
    ws.url = req.headers.origin;
    ws.ip = req.socket.remoteAddress;

    if (ws.correlationId) {
      clients.set(ws.correlationId, ws);
    }

    logger?.info?.('WebSocket connection', {
      operation: 'websocket-connect',
      clientIP: req?.socket?.remoteAddress,
      id: ws.id,
      sessionId: ws.sessionId,
      connectedClients: clients.size,
      correlationId: ws.correlationId,
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (buf) => {
      const raw = buf.toString('utf8');
      const msg = tryParseJSON(raw, null);

      if (!msg) {
        deliver(
          {
            type: WEB_SOCKET_EVENTS.ERROR,
            message: 'Invalid message format',
            timestamp: isoNow(),
          },
          {
            mode: 'unicast',
            correlationId: ws.correlationId,
            fireAndForget: true,
          }
        );
        return;
      }

      switch (msg?.type) {
        case 'ping':
          deliver(
            { type: WEB_SOCKET_EVENTS.PONG, seq: msg.seq, timestamp: isoNow() },
            {
              mode: 'unicast',
              correlationId: ws.correlationId,
              fireAndForget: true,
            }
          );
          break;

        case 'subscribe-batch': {
          const batchId = normalizeBid(msg?.payload?.batchId);
          if (!batchId) break;
          ws.__batchId = batchId;

          let set = byBatch.get(batchId);
          if (!set) {
            set = new Set();
            byBatch.set(batchId, set);
          }
          set.add(ws);

          deliver(
            {
              type: WEB_SOCKET_EVENTS.BATCH_SUBSCRIPTION_CONFIRMED,
              batchId,
              timestamp: isoNow(),
            },
            {
              mode: 'unicast',
              correlationId: ws.correlationId,
              fireAndForget: true,
            }
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
            {
              type: WEB_SOCKET_EVENTS.ERROR,
              message: `Unknown message type: ${msg?.type}`,
              timestamp: isoNow(),
            },
            {
              mode: 'unicast',
              correlationId: ws.correlationId,
              fireAndForget: true,
            }
          );
      }
    });

    ws.on('close', (code, reason) => {
      logger?.debug?.('WS connection close event', {
        operation: 'websocket-close-event',
        id: ws.id,
        correlationId: ws.correlationId,
        code,
        reason: reason ? reason.toString() : '(no reason)',
      });
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
        correlationId: ws.correlationId,
      });

      if (code !== 1001 && code !== 1000) {
        logger?.warn?.('Abnormal WS closure', {
          operation: 'websocket-disconnect-abnormal',
          code,
          reason: reason ? reason.toString() : '(no reason)',
          correlationId: ws.correlationId,
        });
      }
    });

    ws.on('error', (err) => {
      const error = withErrorRef(err, 'websocket-error');
      logger?.error?.('WebSocket error event', {
        operation: 'websocket-error-event',
        id: ws.id,
        correlationId: ws.correlationId,
        errorReference: error.errorReference,
        message: error.message,
        stack: error.stack,
      });
    });
  });

  const emitBatchStarted = (
    { batchId, correlationId, details = {}, entityType, operation },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const cid = correlationId || opts.correlationId || 'unknown';
    const totalCount =
      details.totalCount ?? details.totalItems ?? details.expectedTotal;

    const payload = {
      type: WEB_SOCKET_EVENTS.BATCH_START,
      entityType,
      batchId: bid,
      details: withOperation(
        { ...details, batchId: bid, totalCount },
        operation
      ),
      totalCount,
      timestamp: isoNow(),
      correlationId: cid,
    };

    return emit(payload, { ...opts, batchId: bid, correlationId: cid });
  };

  const emitBatchProgress = (
    {
      batchId,
      completedCount,
      correlationId,
      details = {},
      entityType,
      operation,
      progress,
      totalItems,
    },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const cid = correlationId || opts.correlationId || 'unknown';
    const processedCount =
      details.processedCount ?? details.completedCount ?? completedCount ?? 0;

    const totalCount =
      details.totalCount ?? totalItems ?? details.expectedTotal ?? undefined;

    const payload = {
      type: WEB_SOCKET_EVENTS.BATCH_PROGRESS,
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
      correlationId: cid,
    };

    return emit(payload, { ...opts, batchId: bid, correlationId: cid });
  };

  const emitBatchCompleted = (
    {
      batchId,
      correlationId,
      details = {},
      entityType,
      errors = [],
      failureCount = 0,
      operation,
      successCount = 0,
      totalCount,
    },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const cid = correlationId || opts.correlationId || 'unknown';

    const normalizedTotal =
      details.totalCount ??
      totalCount ??
      (Number.isFinite(successCount) && Number.isFinite(failureCount)
        ? successCount + failureCount
        : undefined);

    const sumSF = (Number(successCount) || 0) + (Number(failureCount) || 0);
    const isEmpty = sumSF === 0 && !Number.isFinite(normalizedTotal);

    if (isEmpty) {
      logger?.trace?.(
        `[ws:drop] empty batch_completed (no totals) for ${bid ?? '(null)'}`
      );
      return Promise.resolve({
        sent: 0,
        failed: 0,
        totalClients: clientCount(),
      });
    }

    const prev = bid ? lastCompletion.get(bid) : null;
    const prevTotal = prev
      ? (Number(prev.success) || 0) + (Number(prev.failure) || 0)
      : -1;
    if (prev && prevTotal > sumSF) {
      logger?.trace?.(`[ws:drop] worse duplicate batch_completed for ${bid}`);
      return Promise.resolve({
        sent: 0,
        failed: 0,
        totalClients: clientCount(),
      });
    }

    const payload = {
      type: WEB_SOCKET_EVENTS.BATCH_COMPLETED,
      operation,
      entityType,
      batchId: bid,
      successCount,
      failureCount,
      totalCount: normalizedTotal,
      details: withOperation(
        {
          ...details,
          batchId: bid,
          successCount,
          failureCount,
          totalCount: normalizedTotal,
          errors,
        },
        operation
      ),
      timestamp: isoNow(),
      correlationId: cid,
    };

    lastCompletion.set(bid, {
      success: Number(successCount) || 0,
      failure: Number(failureCount) || 0,
      total: Number(normalizedTotal) || sumSF,
    });

    return emit(payload, { ...opts, batchId: bid, correlationId: cid });
  };

  const emitBatchFailed = (
    {
      batchId,
      correlationId,
      details = {},
      entityType,
      error,
      failureCount = 0,
      operation,
      successCount = 0,
    },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const cid = correlationId || opts.correlationId || 'unknown';
    const totalCount =
      details.totalCount ??
      (Number.isFinite(successCount) && Number.isFinite(failureCount)
        ? successCount + failureCount
        : undefined);

    const payload = {
      type: WEB_SOCKET_EVENTS.BATCH_FAILED,
      operation,
      entityType,
      batchId: bid,
      successCount,
      failureCount,
      totalCount,
      details: withOperation(
        {
          ...details,
          error,
          successCount,
          failureCount,
          batchId: bid,
          totalCount,
        },
        operation
      ),
      timestamp: isoNow(),
      correlationId: cid,
    };

    return emit(payload, { ...opts, batchId: bid, correlationId: cid });
  };

  const emitSessionCompleted = (
    { correlationId, details = {}, entityType, operation },
    opts = {}
  ) => {
    const cid = correlationId || opts.correlationId || 'unknown';
    const payload = {
      type: WEB_SOCKET_EVENTS.SESSION_COMPLETE,
      entityType,
      details: withOperation({ ...details }, operation),
      timestamp: isoNow(),
      correlationId: cid,
    };

    return emit(payload, { ...opts, correlationId: cid });
  };

  const emitPostProcessingStarted = (
    { correlationId, details = {}, entityType, operation },
    opts = {}
  ) => {
    const cid = correlationId || opts.correlationId || 'unknown';
    const payload = {
      type: WEB_SOCKET_EVENTS.POSTPROC_STARTED,
      operation,
      entityType,
      details: withOperation(details, operation),
      timestamp: isoNow(),
      correlationId: cid,
    };

    return emit(payload, { ...opts, correlationId: cid });
  };

  const emitPostProcessingProgress = (
    {
      correlationId,
      details = {},
      entityType,
      operation,
      processedCount,
      progress,
      totalCount,
    },
    opts = {}
  ) => {
    const cid = correlationId || opts.correlationId || 'unknown';
    const payload = {
      type: WEB_SOCKET_EVENTS.POSTPROC_PROGRESS,
      operation,
      entityType,
      details: withOperation(
        { ...details, processedCount, totalCount, progress },
        operation
      ),
      timestamp: isoNow(),
      correlationId: cid,
    };

    return emit(payload, { ...opts, correlationId: cid });
  };

  const emitPostProcessingCompleted = (
    {
      correlationId,
      details = {},
      entityType,
      errorCount = 0,
      errors = [],
      operation,
      processedCount,
      totalCount,
    },
    opts = {}
  ) => {
    const cid = correlationId || opts.correlationId || 'unknown';
    const payload = {
      type: WEB_SOCKET_EVENTS.POSTPROC_COMPLETED,
      operation,
      entityType,
      details: withOperation(
        { ...details, processedCount, totalCount, errorCount, errors },
        operation
      ),
      timestamp: isoNow(),
      correlationId: cid,
    };

    return emit(payload, { ...opts, correlationId: cid });
  };

  const emitGenerationSessionComplete = (
    { correlationId, details = {}, operation, sessionId },
    opts = {}
  ) => {
    const cid = correlationId || opts.correlationId || 'unknown';
    const payload = {
      type: WEB_SOCKET_EVENTS.GENERATION_SESSION_COMPLETE,
      operation,
      details: withOperation({ ...details, sessionId }, operation),
      timestamp: isoNow(),
      correlationId: cid,
    };

    return emit(payload, { ...opts, correlationId: cid });
  };

  const emitGenerationProgress = (
    {
      batchId,
      correlationId,
      details = {},
      entityType,
      message,
      operation,
      percent,
      phase,
    },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const cid = correlationId || opts.correlationId || 'unknown';

    const payload = {
      type: WEB_SOCKET_EVENTS.GENERATION_PROGRESS,
      operation,
      entityType,
      batchId: bid,
      details: withOperation(
        { ...details, percent, message, phase, batchId: bid },
        operation
      ),
      timestamp: isoNow(),
      correlationId: cid,
    };

    return emit(payload, { ...opts, batchId: bid, correlationId: cid });
  };

  const emitError = (
    {
      batchId,
      correlationId,
      details = {},
      entityType = 'system',
      error,
      errorReference,
      message,
      operation = 'internal-error',
      phase = 'internal',
    },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const cid = correlationId || opts.correlationId || 'unknown';
    const erc =
      errorReference || details.errorReference || createERC(ERC_PREFIX.ERROR);

    const payload = {
      type: WEB_SOCKET_EVENTS.ERROR,
      entityType,
      batchId: bid,
      details: {
        ...details,
        message: message || error || 'Internal server error',
        phase,
        errorReference: erc,
        internal: true,
      },
      operation,
      timestamp: isoNow(),
      correlationId: cid,
      errorReference: erc,
    };

    return emit(payload, {
      ...opts,
      batchId: bid,
      correlationId: cid,
      fireAndForget: false,
    });
  };

  const emitBatchErrorDetails = (
    { batchId, correlationId, importTask, errorReport },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const cid = correlationId || opts.correlationId || 'unknown';

    const payload = {
      type: WEB_SOCKET_EVENTS.BATCH_ERROR_DETAILS,
      batchId: bid,
      correlationId: cid,
      importTask,
      errorReport,
      timestamp: isoNow(),
    };

    return emit(payload, {
      ...opts,
      batchId: bid,
      correlationId: cid,
      fireAndForget: true,
    });
  };

  /**
   * Unified progress emission method (Hierarchical Scope/Status model)
   */
  const emitProgress = (
    {
      batchId,
      correlationId,
      details = {},
      entityType,
      error,
      errorReference,
      message,
      operation,
      percent,
      processedCount,
      scope,
      sessionId,
      status,
      totalCount,
    },
    opts = {}
  ) => {
    const bid = normalizeBid(batchId);
    const cid = correlationId || opts.correlationId || 'unknown';
    const type = status || WEB_SOCKET_EVENTS.PROGRESS;

    const payload = {
      type,
      scope,
      entityType,
      operation,
      sessionId,
      batchId: bid,
      processedCount,
      totalCount,
      percent:
        percent ??
        (processedCount !== undefined && totalCount > 0
          ? Math.round((processedCount / totalCount) * 100)
          : undefined),
      message,
      error,
      errorReference,
      timestamp: isoNow(),
      correlationId: cid,
      details: withOperation({ ...details, sessionId, scope }, operation),
    };

    return emit(payload, { ...opts, batchId: bid, correlationId: cid });
  };

  const stop = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    for (const ws of clients.values()) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1001, 'Server shutting down');
        }
      } catch (_) {}
    }

    try {
      wss.close();
    } catch (_) {}
  };

  const clientCount = () => clients.size || 0;
  const totalClients = () => clientCount();

  const metrics = { sent: 0, failed: 0 };

  function getMetrics() {
    return { ...metrics };
  }

  function resetMetrics() {
    metrics.sent = 0;
    metrics.failed = 0;
  }

  function wrapEmitters(service, logger) {
    const names = [
      'emitBatchStarted',
      'emitBatchProgress',
      'emitBatchCompleted',
      'emitBatchFailed',
      'emitSessionCompleted',
      'emitPostProcessingStarted',
      'emitPostProcessingCompleted',
    ];

    const accumulate = (stats) => {
      if (!stats) return;
      if (Number.isFinite(stats.sent)) metrics.sent += stats.sent;
      else if (Number.isFinite(stats.ok)) metrics.sent += stats.ok;

      if (Number.isFinite(stats.failed)) metrics.failed += stats.failed;
      else if (Number.isFinite(stats.fail)) metrics.failed += stats.fail;
    };

    names.forEach((name) => {
      if (!service || typeof service[name] !== 'function') return;
      const orig = service[name].bind(service);

      service[name] = (payload, opts) => {
        try {
          const r = orig(payload, opts);
          if (r && typeof r.then === 'function') {
            return r
              .then((res) => {
                accumulate(res);
                return res;
              })
              .catch((err) => {
                metrics.failed += 1;
                if (logger?.error)
                  logger.error(`WS emit failed (${name})`, err);
                throw err;
              });
          }

          accumulate(r);
          return r;
        } catch (err) {
          metrics.failed += 1;
          if (logger?.error) logger.error(`WS emit failed (${name})`, err);
          throw err;
        }
      };
    });
  }

  const service = {
    clientCount,
    totalClients,
    emitBatchStarted,
    emitBatchProgress,
    emitBatchCompleted,
    emitBatchFailed,
    emitSessionCompleted,
    emitPostProcessingStarted,
    emitPostProcessingProgress,
    emitPostProcessingCompleted,
    emitGenerationSessionComplete,
    emitGenerationProgress,
    emitProgress,
    emitError,
    emitBatchErrorDetails,
    stop,
    applyWsConfig,
    refreshWsConfigFromRemote,
    getMetrics,
    resetMetrics,
  };

  wrapEmitters(service, logger);

  return service;
}

module.exports = { createWebSocketService };
