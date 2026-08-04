const { URL } = require('url');
const { WebSocket, WebSocketServer } = require('ws');
const { tryParseJSON, createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Mirrors requestSigningMiddleware's loopback bypass (securityMiddleware.cjs)
// -- local CLI scripts/tests connecting to the WS endpoint from the same
// host don't carry a Liferay JWT.
function isLoopbackSocket(socket) {
  const addr = socket?.remoteAddress;
  return LOOPBACK_ADDRESSES.has(addr);
}

class WebSocketService {
  constructor(ctx) {
    this.ctx = ctx;
    this.clients = new Map(); // id -> ws
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = 30000;
  }

  init(server) {
    const { logger, verifyBearerToken, resolveLiferayUrl } = this.ctx;
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', async (request, socket, head) => {
      // Browser WebSocket clients cannot set a custom Authorization header on
      // the handshake, so the frontend sends its Liferay JWT as a query
      // param instead (see useRealtimeWebSocket.js). Loopback connections
      // (local CLI scripts/tests) are exempt, matching
      // requestSigningMiddleware's existing bypass for the same case.
      if (!isLoopbackSocket(socket)) {
        let token;
        try {
          const url = new URL(request.url, 'http://internal');
          token = url.searchParams.get('token');
        } catch {
          token = null;
        }

        if (!token) {
          logger.warn('WebSocket upgrade rejected: no auth token supplied', {
            remoteAddress: socket.remoteAddress,
          });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          await verifyBearerToken(token, resolveLiferayUrl());
        } catch (err) {
          logger.warn('WebSocket upgrade rejected: invalid auth token', {
            remoteAddress: socket.remoteAddress,
            error: err.message,
          });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }

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
      totalSteps: session.totalSteps,
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
      errorStack: error.stack || options.errorStack,
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
