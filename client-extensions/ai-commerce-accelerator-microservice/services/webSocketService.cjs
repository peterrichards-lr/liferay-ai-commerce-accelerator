const WebSocket = require('ws');
const { tryParseJSON, createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class WebSocketService {
  constructor(ctx) {
    this.ctx = ctx;
    this.clients = new Map(); // id -> ws
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = 30000;
  }

  init(server) {
    const { logger } = this.ctx;
    const wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    wss.on('connection', (ws, req) => {
      const id = createERC(ERC_PREFIX.BATCH);
      ws.id = id;
      ws.isAlive = true;
      ws.correlationId = req.headers['x-correlation-id'] || createERC('WS');

      this.clients.set(id, ws);

      logger.info('WebSocket client connected', {
        id,
        correlationId: ws.correlationId,
      });

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (data) => {
        try {
          const msg = tryParseJSON(data.toString());
          if (msg?.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch (err) {
          logger.error('Failed to parse WebSocket message', {
            id,
            error: err.message,
          });
        }
      });

      ws.on('close', () => {
        this.clients.delete(id);
        logger.info('WebSocket client disconnected', { id });
      });

      ws.on('error', (err) => {
        logger.error('WebSocket error', { id, error: err.message });
      });
    });

    this.heartbeatTimer = setInterval(() => {
      this.clients.forEach((ws) => {
        if (!ws.isAlive) {
          logger.warn('Terminating unresponsive WebSocket client', {
            id: ws.id,
          });
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, this.heartbeatIntervalMs);

    this.wss = wss;
    return wss;
  }

  async broadcast(event) {
    const { logger } = this.ctx;
    const payload = JSON.stringify(event);

    let sentCount = 0;
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
          sentCount++;
        } catch (err) {
          logger.error('Failed to send WebSocket message', {
            id: ws.id,
            error: err.message,
          });
        }
      }
    });

    return sentCount;
  }

  emitSessionStarted(session, options = {}) {
    return this.broadcast({
      type: 'STARTED',
      scope: 'session',
      sessionId: session.id,
      flowType: session.type,
      correlationId: options.correlationId || session.correlationId,
    });
  }

  emitSessionProgress(session, progress, options = {}) {
    return this.broadcast({
      type: 'PROGRESS',
      scope: 'session',
      sessionId: session.id,
      progress,
      correlationId: options.correlationId || session.correlationId,
    });
  }

  emitSessionCompleted(session, options = {}) {
    return this.broadcast({
      type: 'COMPLETED',
      scope: 'session',
      sessionId: session.id,
      correlationId: options.correlationId || session.correlationId,
    });
  }

  emitSessionFailed(session, error, options = {}) {
    return this.broadcast({
      type: 'FAILED',
      scope: 'session',
      sessionId: session.id,
      error: error.message || error,
      correlationId: options.correlationId || session.correlationId,
    });
  }

  emitStepStarted(sessionId, stepKey, entityType, options = {}) {
    return this.broadcast({
      type: 'STARTED',
      scope: 'step',
      sessionId,
      stepKey,
      entityType,
      correlationId: options.correlationId,
    });
  }

  emitStepProgress(
    sessionId,
    stepKey,
    entityType,
    completedCount,
    totalCount,
    options = {}
  ) {
    return this.broadcast({
      type: 'PROGRESS',
      scope: 'step',
      sessionId,
      stepKey,
      entityType,
      completedCount,
      totalCount,
      correlationId: options.correlationId,
    });
  }

  emitStepCompleted(sessionId, stepKey, entityType, options = {}) {
    return this.broadcast({
      type: 'COMPLETED',
      scope: 'step',
      sessionId,
      stepKey,
      entityType,
      correlationId: options.correlationId,
    });
  }

  emitStepFailed(sessionId, stepKey, entityType, error, options = {}) {
    return this.broadcast({
      type: 'FAILED',
      scope: 'step',
      sessionId,
      stepKey,
      entityType,
      error: error.message || error,
      correlationId: options.correlationId,
    });
  }

  emitBatchStarted(
    sessionId,
    batchERC,
    entityType,
    totalItems,
    operation,
    options = {}
  ) {
    return this.broadcast({
      type: 'STARTED',
      scope: 'batch',
      sessionId,
      batchERC,
      entityType,
      totalItems,
      operation,
      correlationId: options.correlationId,
    });
  }

  emitBatchProgress(
    sessionId,
    batchERC,
    entityType,
    completedCount,
    totalItems,
    operation,
    options = {}
  ) {
    return this.broadcast({
      type: 'PROGRESS',
      scope: 'batch',
      sessionId,
      batchERC,
      entityType,
      completedCount,
      totalItems,
      operation,
      correlationId: options.correlationId,
    });
  }

  emitBatchCompleted(
    sessionId,
    batchERC,
    entityType,
    successCount,
    failureCount,
    operation,
    options = {}
  ) {
    return this.broadcast({
      type: 'COMPLETED',
      scope: 'batch',
      sessionId,
      batchERC,
      entityType,
      successCount,
      failureCount,
      operation,
      correlationId: options.correlationId,
    });
  }

  emitBatchFailed(
    sessionId,
    batchERC,
    entityType,
    error,
    operation,
    options = {}
  ) {
    return this.broadcast({
      type: 'FAILED',
      scope: 'batch',
      sessionId,
      batchERC,
      entityType,
      error: error.message || error,
      operation,
      correlationId: options.correlationId,
    });
  }

  emitError(errorEvent) {
    return this.broadcast({
      type: 'FAILED',
      scope: errorEvent.scope || 'internal',
      ...errorEvent,
    });
  }

  emitProgress(data) {
    return this.broadcast(data);
  }

  emitGenerationSessionComplete(data) {
    return this.broadcast({
      type: 'COMPLETED',
      scope: 'session',
      ...data,
    });
  }

  close() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.clients.forEach((ws) => {
      try {
        ws.close();
      } catch {
        // Ignore error
      }
    });
    if (this.wss) {
      this.wss.close();
    }
  }
}

function createWebSocketService(ctx = {}) {
  return new WebSocketService(ctx);
}

module.exports = { WebSocketService, createWebSocketService };
