// services/webSocketService.cjs
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { BATCH_START } = require('../utils/wsEvents.cjs');

function createWebSocketService({
  server,
  logger = console,
  heartbeatIntervalMs = 30_000, // ping every 30s
} = {}) {
  if (!server) throw new Error('webSocketService requires an HTTP server');

  const wss = new WebSocket.Server({ server });

  // Track subscribers (optionally by batch)
  const clients = new Set(); // all sockets
  const byBatch = new Map(); // batchId -> Set<ws>

  // Basic helpers
  const safeJSON = (o) => JSON.stringify(o);
  const safeSend = (ws, payload) => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(safeJSON(payload));
    } catch (err) {
      logger?.warn?.('WS send failed:', err?.message || err);
    }
  };

  // Connection handling
  wss.on('connection', (ws, req) => {
    ws.id = uuidv4();
    ws.isAlive = true;
    clients.add(ws);

    logger?.info?.('WebSocket connection', {
      operation: 'websocket-connect',
      clientIP: req?.socket?.remoteAddress,
      id: ws.id,
      connectedClients: clients.size,
    });

    // Health
    ws.on('pong', () => (ws.isAlive = true));

    // Messages from client
    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString('utf8'));
      } catch {
        safeSend(ws, { type: 'error', message: 'Invalid message format' });
        return;
      }

      switch (msg?.type) {
        case 'ping':
          safeSend(ws, { type: 'pong', seq: msg.seq, timestamp: now() });
          break;

        case 'subscribe-batch': {
          const batchId = msg?.payload?.batchId;
          if (!batchId) break;
          ws.__batchId = batchId;
          let set = byBatch.get(batchId);
          if (!set) byBatch.set(batchId, (set = new Set()));
          set.add(ws);
          safeSend(ws, {
            type: 'batch_subscription_confirmed',
            batchId,
            timestamp: now(),
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
          safeSend(ws, {
            type: 'error',
            message: `Unknown message type: ${msg?.type}`,
            timestamp: now(),
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
    safeSend(ws, { type: 'connected', timestamp: now() });
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

  // Broadcast helpers
  function broadcast(payload, { batchId } = {}) {
    const packet = safeJSON(payload);
    let targets;

    if (batchId && byBatch.has(batchId)) {
      targets = byBatch.get(batchId);
    } else if (payload?.batchId && byBatch.has(payload.batchId)) {
      targets = byBatch.get(payload.batchId);
    } else {
      targets = clients;
    }

    let sent = 0;
    for (const ws of targets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(packet);
          sent++;
        } catch {}
      }
    }
    return sent;
  }

  // Emitters that match your UI hook
  const emitBatchStarted = ({ batchId, entityType, totalItems }) =>
    broadcast({
      type: BATCH_START,
      batchId,
      entityType,
      totalItems,
      timestamp: now(),
    });

  const emitBatchProgress = ({
    batchId,
    entityType,
    completedCount,
    totalItems,
    progress,
  }) =>
    broadcast({
      type: 'batch_progress',
      batchId,
      entityType,
      completedCount,
      totalItems,
      progress,
      timestamp: now(),
    });

  const emitBatchCompleted = ({
    batchId,
    entityType,
    successCount,
    failureCount = 0,
    errors = [],
  }) =>
    broadcast({
      type: 'batch_completed',
      batchId,
      entityType,
      successCount,
      failureCount,
      errors,
      timestamp: now(),
    });

  const emitSessionCompleted = ({ entityType }) =>
    broadcast({ type: 'session_completed', entityType, timestamp: now() });

  const emitPostProcessingStarted = ({ entityType }) =>
    broadcast({
      type: 'post_processing_started',
      entityType,
      timestamp: now(),
    });

  const emitPostProcessingProgress = ({
    entityType,
    processedCount,
    totalCount,
    progress,
  }) =>
    broadcast({
      type: 'post_processing_progress',
      entityType,
      data: { processedCount, totalCount, progress },
      timestamp: now(),
    });

  const emitPostProcessingCompleted = ({
    entityType,
    processedCount,
    totalCount,
    errorCount = 0,
    errors = [],
  }) =>
    broadcast({
      type: 'post_processing_completed',
      entityType,
      data: { processedCount, totalCount, errorCount, errors },
      timestamp: now(),
    });

  const emitGenerationSessionComplete = () =>
    broadcast({ type: 'generation_session_complete', timestamp: now() });

  const emitGenerationProgress = ({
    percent,
    message,
    phase,
    batchId,
    entityType,
  } = {}) =>
    broadcast(
      {
        type: 'generation-progress',
        percent,
        message,
        phase,
        entityType,
        ...(batchId ? { batchId } : {}),
        timestamp: new Date().toISOString(),
      },
      { batchId }
    );

  const emitBatchFailed = ({
    batchId,
    entityType,
    error,
    successCount = 0,
    failureCount = 0,
    details = {},
  }) =>
    broadcast({
      type: 'batch_failed',
      batchId,
      entityType,
      error,
      successCount,
      failureCount,
      details,
      timestamp: new Date().toISOString(),
    });

  function stop() {
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
  }

  const now = () => new Date().toISOString();

  // Public API
  return {
    wss, // keep for legacy constructors that expect the raw server
    broadcast,
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
