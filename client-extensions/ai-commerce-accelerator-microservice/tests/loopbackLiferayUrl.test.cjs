const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * A colocated client extension must never accept a loopback Liferay URL.
 *
 * Run 36014266810 measured `com.liferay.lxc.dxp.main.domain = localhost` in
 * the config tree, while `LIFERAY_LXC_DXP_MAIN_DOMAIN=aica-unit.invalid` sat
 * correct and unused in the environment - config-node consults config trees
 * before individual environment variables. The microservice then spent forty
 * minutes on `connect ECONNREFUSED 127.0.0.1:8080`, calling itself.
 *
 * The same value is right in local development, where the microservice is a
 * host process and Liferay really is on localhost. These assert both halves.
 * See #1137.
 */
// Why the ambient family has to go, and why it is matched by prefix rather
// than by name, is in the fixture. `tests/setup.mjs` sweeps it before any test
// file loads, which is what actually protects these cases.
//
// The call inside `withEnv` is defence in depth and NOT a guard: no case here
// sets a COM_LIFERAY_LXC_* variable, so replacing it with `const saved = {}`
// leaves this file green with the ambient exported. Kept because a future case
// may set one; counted as nothing. See #1199, #1203.
//
// The hostnames below are `.invalid` rather than `aica-e2e.demo` for the
// reason in healthCheckTarget.test.cjs: the orchestrator exports that exact
// string, so a case asserting it cannot tell its own setup from the ambient.
const { clearAmbientLxcEnv } = require('./fixtures/ambientLxcEnv.cjs');

function withEnv(vars, fn) {
  const saved = clearAmbientLxcEnv();

  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // ENV and the resolver both capture at require time.
  for (const k of Object.keys(require.cache)) {
    if (/utils\/(constants|liferayEnv|lxcReadiness)\.cjs$/.test(k)) {
      delete require.cache[k];
    }
  }
  try {
    return fn(require('../utils/liferayEnv.cjs'));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const k of Object.keys(require.cache)) {
      if (/utils\/(constants|liferayEnv|lxcReadiness)\.cjs$/.test(k)) {
        delete require.cache[k];
      }
    }
  }
}

// Directory only, no key file. `isColocatedDeployment` tests existence, and
// application.json points config-node's own tree provider at
// LIFERAY_ROUTES_DXP - so writing a key here would feed the resolver a fourth
// candidate and quietly change what these assert.
function colocatedTree() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lxc-colo-'));
}

// The SDK freezes this at construction; a stub is the whole point.
const oauthService = (url) => ({ getDefaultLiferayUrl: () => url });

// Credentials are validated after the URL. Supplied so these cases fail on the
// thing they are about.
const CREDS = { clientId: 'test-id', clientSecret: 'test-secret' };

describe('a loopback Liferay URL is refused when colocated (#1137)', () => {
  const made = [];
  afterEach(() => {
    while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
  });
  const tree = () => {
    const d = colocatedTree();
    made.push(d);
    return d;
  };

  test('falls through to the LXC environment when the tree says localhost', () => {
    const dir = tree();
    withEnv(
      {
        LIFERAY_ROUTES_DXP: dir,
        LIFERAY_LXC_DXP_MAIN_DOMAIN: 'aica-unit.invalid',
        LIFERAY_LXC_DXP_SERVER_PROTOCOL: 'https',
        LIFERAY_API_URL: undefined,
      },
      ({ resolveEffectiveLiferayConnection }) => {
        const resolved = resolveEffectiveLiferayConnection(
          CREDS,
          oauthService('https://localhost'),
          null
        );
        expect(resolved.liferayUrl).toBe('https://aica-unit.invalid');
      }
    );
  });

  test('leaves a local run alone, where loopback is correct', () => {
    withEnv(
      {
        LIFERAY_ROUTES_DXP: '/no/such/tree',
        LIFERAY_LXC_DXP_MAIN_DOMAIN: undefined,
        LIFERAY_API_URL: undefined,
      },
      ({ resolveEffectiveLiferayConnection }) => {
        const resolved = resolveEffectiveLiferayConnection(
          CREDS,
          oauthService('http://localhost:8080'),
          null
        );
        expect(resolved.liferayUrl).toBe('http://localhost:8080');
      }
    );
  });

  test('accepts a routable derived URL unchanged', () => {
    const dir = tree();
    withEnv(
      { LIFERAY_ROUTES_DXP: dir, LIFERAY_LXC_DXP_MAIN_DOMAIN: 'other.demo' },
      ({ resolveEffectiveLiferayConnection }) => {
        const resolved = resolveEffectiveLiferayConnection(
          CREDS,
          oauthService('https://aica-unit.invalid'),
          null
        );
        expect(resolved.liferayUrl).toBe('https://aica-unit.invalid');
      }
    );
  });

  // Better an honest failure than a wrong URL. This is the state #1132
  // accidentally replaced with a silent misdirection.
  test('still throws when no usable source exists', () => {
    const dir = tree();
    withEnv(
      {
        LIFERAY_ROUTES_DXP: dir,
        LIFERAY_LXC_DXP_MAIN_DOMAIN: undefined,
        LIFERAY_API_URL: undefined,
      },
      ({ resolveEffectiveLiferayConnection }) => {
        expect(() =>
          resolveEffectiveLiferayConnection(
            CREDS,
            oauthService('https://127.0.0.1'),
            null
          )
        ).toThrow(/Liferay URL is not configured/);
      }
    );
  });

  test.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['127.10.0.9', true],
    ['aica-unit.invalid', false],
    ['localhost.example.com', false],
  ])('%s is loopback: %s', (host, loopback) => {
    const dir = tree();
    withEnv({ LIFERAY_ROUTES_DXP: dir }, ({ isUsableLiferayUrl }) => {
      expect(isUsableLiferayUrl(`https://${host}`)).toBe(!loopback);
    });
  });
});
