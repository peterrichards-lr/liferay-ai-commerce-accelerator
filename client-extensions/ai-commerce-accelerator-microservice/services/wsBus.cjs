const { createWebSocketService } = require('./webSocketService.cjs');
let ws;

function init(server, logger) {
  ws = createWebSocketService({ server, logger });
  return ws;
}
function get() {
  if (!ws) throw new Error('WS not initialized');
  return ws;
}

module.exports = { init, get };
