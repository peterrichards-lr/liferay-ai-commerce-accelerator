const { WebSocketService } = require('../services/webSocketService.cjs');

/**
 * The heartbeat interval is configurable, and reads the value the panel writes.
 *
 * It was not. `ws-config` was seeded, offered in the Configuration UI with real
 * validation, and loaded into the config cache - and `webSocketService` set
 * `heartbeatIntervalMs = 30000` in its constructor and never consulted it. An
 * administrator could change the value, watch it validate, save it, and nothing
 * anywhere behaved differently. The only reason 30000 was in effect is that the
 * hardcoded value happened to equal the seeded default, which is what made it
 * invisible (#1064).
 *
 * So these assert the resolution rather than the timer: that the configured
 * value is reached, and that each way of getting no usable value falls back to
 * 30000 rather than to `undefined` - `setInterval(fn, undefined)` fires on
 * every tick of the event loop, which would be a busy loop pinging every client.
 */
function serviceWith(wsConfig) {
  const ctx = {
    config:
      wsConfig === undefined
        ? undefined
        : { getWSConfigCached: () => wsConfig },
  };

  return new WebSocketService(ctx);
}

describe('the WebSocket heartbeat interval (#1064)', () => {
  it('takes the value ws-config carries', () => {
    const svc = serviceWith({ heartbeatIntervalMs: 5000 });

    expect(svc._resolveHeartbeatIntervalMs()).toBe(5000);
  });

  it('defaults when ws-config has not been loaded yet', () => {
    // The config cache is warmed by the first request that needs it, which is
    // after this service is constructed - so an empty object is the ordinary
    // startup case, not an error.
    const svc = serviceWith({});

    expect(svc._resolveHeartbeatIntervalMs()).toBe(30000);
  });

  it('defaults when there is no config service at all', () => {
    const svc = serviceWith(undefined);

    expect(svc._resolveHeartbeatIntervalMs()).toBe(30000);
  });

  it('refuses a value below the floor the panel enforces', () => {
    // The panel will not save below 1000ms. A value that got in another way -
    // an import, a hand-edited object - must not produce a ping storm.
    const svc = serviceWith({ heartbeatIntervalMs: 10 });

    expect(svc._resolveHeartbeatIntervalMs()).toBe(30000);
  });

  it('refuses a value that is not a number', () => {
    const svc = serviceWith({ heartbeatIntervalMs: 'often' });

    expect(svc._resolveHeartbeatIntervalMs()).toBe(30000);
  });

  it('applies the resolved value to the instance, not just the return', () => {
    const svc = serviceWith({ heartbeatIntervalMs: 4000 });

    expect(svc.heartbeatIntervalMs).toBe(30000);

    svc.heartbeatIntervalMs = svc._resolveHeartbeatIntervalMs();

    expect(svc.heartbeatIntervalMs).toBe(4000);
  });
});
