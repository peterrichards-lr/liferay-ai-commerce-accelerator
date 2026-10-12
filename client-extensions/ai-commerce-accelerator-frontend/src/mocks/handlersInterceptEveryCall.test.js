import { describe, it, expect } from 'vitest';
import { handlers } from './handlers';
import { DEFAULTS } from '../config/defaults';

/**
 * The mocks have to intercept, not merely exist.
 *
 * msw 3 intercepts the CORS preflight; msw 2 did not. The frontend is served
 * by Liferay and calls the microservice on another origin, so happy-dom sends
 * an `OPTIONS` ahead of these requests. With no handler for it the preflight
 * went to the real network, nothing was listening on 3001, and the request
 * that mattered failed as a `NetworkError` - one test of 433, and the
 * component rendered its disconnected state rather than its data.
 *
 * A suite that makes a real network call has stopped testing what it says it
 * tests, so this asserts the interception itself rather than waiting for a
 * component to notice. See #1233.
 */
describe('the msw handlers intercept every call the app makes (#1233)', () => {
  const microservice = DEFAULTS.microserviceUrl;

  it('answers the CORS preflight for the microservice origin', async () => {
    const preflight = handlers.find(
      (handler) => handler.info?.method === 'OPTIONS'
    );

    expect(
      preflight,
      'without this the preflight reaches the real network'
    ).toBeDefined();

    const response = await preflight.run({
      request: new Request(`${microservice}/api/v1/config/health`, {
        method: 'OPTIONS',
      }),
    });

    expect(response?.response?.status).toBe(204);
    expect(response?.response?.headers.get('Access-Control-Allow-Origin')).toBe(
      '*'
    );
  });

  it('keeps the catch-alls where resetHandlers restores them', () => {
    // These two lived in a `server.use()` inside `beforeAll`, which
    // `resetHandlers()` in `afterEach` removed after the first test of every
    // file. In the initial set they survive, because a reset restores to it.
    const paths = handlers.map((handler) => handler.info?.path);

    expect(paths).toContain('*/api/v1/config/ai');
    expect(paths).toContain('*/');
  });

  it('points at the microservice URL the app actually uses', () => {
    // A handler list that drifts from `DEFAULTS.microserviceUrl` matches
    // nothing, which looks exactly like the defect above.
    const absolute = handlers
      .map((handler) => handler.info?.path)
      .filter((path) => typeof path === 'string' && path.startsWith('http'));

    expect(absolute.length).toBeGreaterThan(0);
    for (const path of absolute) {
      expect(path.startsWith(microservice)).toBe(true);
    }
  });
});
