const { createWebSocketService } = require('./webSocketService.cjs');

let ws;
const metrics = { sent: 0, failed: 0 };

function init(server, logger) {
  ws = createWebSocketService({ server, logger });
  wrapEmitters(logger);
  return ws;
}

function get() {
  if (!ws) throw new Error('WS not initialized');
  return ws;
}

function totalClients() {
  try {
    if (ws && typeof ws.totalClients === 'function') return ws.totalClients();
    if (ws && ws.clients && typeof ws.clients.size === 'number')
      return ws.clients.size;
  } catch {}
  return 0;
}

function getMetrics() {
  return { ...metrics };
}

function resetMetrics() {
  metrics.sent = 0;
  metrics.failed = 0;
}

function getBroadcastMeta(batchId, entityType) {
  return {
    batchId,
    entityType,
    totalClients: totalClients(),
    sent: metrics.sent,
    failed: metrics.failed,
  };
}

function wrapEmitters(logger) {
  const names = [
    'emitBatchStarted',
    'emitBatchProgress',
    'emitBatchCompleted',
    'emitGenerationSessionComplete',
    'emitPostProcessingStarted',
    'emitPostProcessingCompleted',
  ];

  const accumulate = (result) => {
    if (typeof result === 'number') {
      metrics.sent += result;
    } else if (result && typeof result === 'object') {
      if (Number.isFinite(result.sent)) metrics.sent += result.sent;
      else metrics.sent += totalClients();
      if (Number.isFinite(result.failed)) metrics.failed += result.failed;
    } else {
      metrics.sent += totalClients();
    }
  };

  names.forEach((name) => {
    if (!ws || typeof ws[name] !== 'function') return;
    const orig = ws[name].bind(ws);

    ws[name] = (payload, opts) => {
      try {
        const r = orig(payload, opts);
        if (r && typeof r.then === 'function') {
          return r
            .then((stat) => {
              accumulate(stat);
              return stat;
            })
            .catch((err) => {
              metrics.failed += 1;
              throw err;
            });
        }
        accumulate(r);
        return r;
      } catch (err) {
        metrics.failed += 1;
        if (logger && logger.error)
          logger.error(`WS emit failed (${name})`, err);
        throw err;
      }
    };
  });
}

module.exports = {
  init,
  get,
  totalClients,
  getMetrics,
  resetMetrics,
  getBroadcastMeta,
};
