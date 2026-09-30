const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The health check must not probe its own container.
 *
 * `checkLiferay` filled a missing target with `ENV.LIFERAY_URL`, whose default
 * is `http://localhost:8080`. On a colocated deployment that is THIS
 * container, not Liferay. Run 36433590783 spent 378 token requests and 630
 * `ECONNREFUSED 127.0.0.1:8080` on it, all for one client id, while the same
 * log named `https://aica-e2e.demo` correctly seconds earlier. Unhealthy
 * results are deliberately not cached, so the wrong address was retried for
 * the life of the container and read as a connectivity fault.
 *
 * The SDK could not have prevented it: `_createOrGetAccessToken(liferayUrl, …)`
 * uses the URL its caller passes, and the caller passed loopback.
 *
 * These cases assert what reaches `testConnection`, not that a resolver was
 * called - the latter is satisfied by a resolver that returns loopback. See
 * #1197.
 */

// Set before anything is required: `constants.cjs` snapshots the environment
// at load, and a value arriving afterwards would be read from the real
// container paths instead - where the routes directory does not exist, every
// case would run as "not colocated", and the case that matters could not fail.
// `assertTheEnvironmentTook` below refuses to let that pass silently.
const ROUTES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-routes-'));

// Deliberately not `aica-e2e.demo`, which is what `scripts/run-e2e-ldm.sh`
// exports as COM_LIFERAY_LXC_DXP_MAIN_DOMAIN before the orchestrator reaches
// `yarn test`.
//
// The perturbation that establishes this is deleting the PRODUCTION fallback -
// `utils/liferayEnv.cjs`'s LXC_ENV branch - not deleting the setter below.
// With the fallback gone, the sweep removed and the ambient present,
// `aica-e2e.demo` passes and `aica-unit.invalid` fails: the ambient supplies
// exactly the value the old literal asserted.
//
// An earlier version of this comment claimed that deleting the setter below
// would have left the case green. It would not: `assertTheEnvironmentTook`
// asserts that value first. That claim came from a perturbation which deleted
// the assertion along with the setter - testing against the expectation rather
// than against the code, which is the anchoring quality-guardrails §4 names.
// See #1199, #1203.
const DOMAIN = 'aica-unit.invalid';

process.env.LIFERAY_ROUTES_DXP = ROUTES_DIR;
process.env.LIFERAY_LXC_DXP_MAIN_DOMAIN = DOMAIN;
process.env.LIFERAY_LXC_DXP_SERVER_PROTOCOL = 'https';
delete process.env.LIFERAY_URL;
delete process.env.LIFERAY_API_URL;

const HealthService = require('../services/healthService.cjs');
const ConfigService = require('../services/configService.cjs');
const { ENV } = require('../utils/constants.cjs');

function assertTheEnvironmentTook() {
  expect(ENV.LIFERAY_ROUTES_DXP).toBe(ROUTES_DIR);
  expect(ENV.LIFERAY_LXC_DXP_MAIN_DOMAIN).toBe(DOMAIN);
  expect(ENV.LIFERAY_URL).toBe('http://localhost:8080');
}

// `isColocatedDeployment()` is `existsSync(LIFERAY_ROUTES_DXP)`, read at call
// time - so the topology is whether the directory is there, which is the real
// distinction rather than a flag invented for the test. The opposite topology
// lives in healthCheckTargetWithoutLxc.test.cjs: `constants.cjs` snapshots the
// environment at load and `vi.resetModules()` does not reload a `require`d
// .cjs module, so the two cannot share a file. Measured, not assumed - the
// version that tried returned the domain it had just deleted.
function colocated() {
  fs.mkdirSync(ROUTES_DIR, { recursive: true });
}

// A real ConfigService, so the seam under test is the one that ships. A stub
// returning a good URL would pass whatever healthService did with it.
function build() {
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

  // Credentials without a URL: what the routes tree actually yields, and the
  // case the ENV fallback existed to cover.
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

  return { health, testConnection };
}

afterAll(() => fs.rmSync(ROUTES_DIR, { recursive: true, force: true }));

describe('the Liferay health check target (#1197)', () => {
  it('uses the LXC domain rather than its own loopback when colocated', async () => {
    assertTheEnvironmentTook();
    colocated();

    const { health, testConnection } = build();
    const result = await health.checkLiferay();

    expect(testConnection).toHaveBeenCalledTimes(1);
    const sent = testConnection.mock.calls[0][0];
    expect(sent.liferayUrl).toBe(`https://${DOMAIN}`);
    // The literal that produced 630 log lines.
    expect(sent.liferayUrl).not.toContain('localhost');
    expect(sent.liferayUrl).not.toContain('127.0.0.1');
    // The credentials must survive the substitution - replacing the URL and
    // losing the client id would authenticate against nothing.
    expect(sent.clientId).toBe('id-ba31cd50');
    expect(sent.clientSecret).toBe('secret');
    expect(result.status).toBe('healthy');
  });
});
