const os = require('node:os');
const path = require('node:path');

/**
 * The other half of #1197: the environment fallback must survive the fix.
 *
 * `checkLiferay` now resolves a reachable target before falling back to
 * `ENV.LIFERAY_URL`. A "fix" that deleted the fallback rather than reordering
 * it would pass every case in `healthCheckTarget.test.cjs` and break local
 * development, where the microservice is a host process and Liferay really is
 * on `http://localhost:8080`.
 *
 * Its own file because `constants.cjs` snapshots the environment at load and
 * `vi.resetModules()` does not reload a `require`d .cjs module - measured,
 * after a version that tried to do both topologies in one file kept returning
 * the domain it had just deleted from `process.env`.
 */

// No routes tree and no LXC domain: a standalone deployment. Set before any
// require, for the reason in the header.
process.env.LIFERAY_ROUTES_DXP = path.join(os.tmpdir(), 'aica-no-routes-here');
delete process.env.LIFERAY_LXC_DXP_MAIN_DOMAIN;
delete process.env.LIFERAY_LXC_DXP_SERVER_PROTOCOL;
delete process.env.LIFERAY_URL;
delete process.env.LIFERAY_API_URL;

const HealthService = require('../services/healthService.cjs');
const ConfigService = require('../services/configService.cjs');
const { ENV } = require('../utils/constants.cjs');

describe('the Liferay health check target, with no LXC tree (#1197)', () => {
  it('falls back to the environment when nothing resolvable is configured', async () => {
    // Or this case passes for the wrong reason.
    expect(ENV.LIFERAY_LXC_DXP_MAIN_DOMAIN).toBeFalsy();
    expect(ENV.LIFERAY_URL).toBe('http://localhost:8080');

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const config = new ConfigService({
      cache: new Map(),
      logger,
      oauth: {},
      persistence: {},
    });
    config.getOAuthConfig = vi.fn().mockResolvedValue({
      clientId: 'id-ba31cd50',
      clientSecret: 'secret',
    });

    const testConnection = vi.fn().mockResolvedValue(true);
    const health = new HealthService({
      config,
      persistence: {},
      logger,
      liferay: { rest: { testConnection } },
    });

    await health.checkLiferay();

    expect(testConnection.mock.calls[0][0].liferayUrl).toBe(
      'http://localhost:8080'
    );
    expect(testConnection.mock.calls[0][0].clientId).toBe('id-ba31cd50');
  });
});
