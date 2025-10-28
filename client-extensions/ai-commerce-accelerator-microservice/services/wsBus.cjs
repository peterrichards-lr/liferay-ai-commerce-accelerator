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

function normalizeStats(result) {
  const total = totalClients();

  if (result && typeof result === 'object') {
    const ok = Number.isFinite(result.ok)
      ? result.ok
      : Number.isFinite(result.sent)
      ? result.sent
      : 0;
    const fail = Number.isFinite(result.fail)
      ? result.fail
      : Number.isFinite(result.failed)
      ? result.failed
      : 0;
    const tot = Number.isFinite(result.total)
      ? result.total
      : Number.isFinite(result.totalClients)
      ? result.totalClients
      : total;

    return {
      ok,
      fail,
      total: tot,

      sent: ok,
      failed: fail,
      totalClients: tot,
    };
  }

  if (typeof result === 'number') {
    const ok = result;
    return {
      ok,
      fail: Math.max(0, total - ok),
      total,
      sent: ok,
      failed: Math.max(0, total - ok),
      totalClients: total,
    };
  }

  return {
    ok: total,
    fail: 0,
    total,
    sent: total,
    failed: 0,
    totalClients: total,
  };
}

function wrapEmitters(logger) {
  const names = [
    'emitBatchStarted',
    'emitBatchProgress',
    'emitBatchCompleted',
    'emitBatchFailed',
    'emitGenerationSessionComplete',
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
    if (!ws || typeof ws[name] !== 'function') return;
    const orig = ws[name].bind(ws);

    ws[name] = (payload, opts) => {
      try {
        const r = orig(payload, opts);
        if (r && typeof r.then === 'function') {
          return r
            .then((res) => {
              const stats = normalizeStats(res);
              accumulate(stats);
              return stats;
            })
            .catch((err) => {
              metrics.failed += 1;
              if (logger?.error) logger.error(`WS emit failed (${name})`, err);
              throw err;
            });
        }

        const stats = normalizeStats(r);
        accumulate(stats);
        return stats;
      } catch (err) {
        metrics.failed += 1;
        if (logger?.error) logger.error(`WS emit failed (${name})`, err);
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
