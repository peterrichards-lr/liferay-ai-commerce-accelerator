const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * A caller that states no Liferay URL must still be given a reachable one.
 *
 * Run 36226890870 spent itself on `ECONNREFUSED 127.0.0.1:443` - 3239 of
 * them - against `https://localhost`. That value was not stale and was not
 * a failed read: `com.liferay.lxc.dxp.main.domain` holds `localhost`
 * because Liferay correctly records its own listener, and the SDK read it
 * successfully every time. It is simply unreachable from a different
 * container on the same host.
 *
 * The dashboard states its target, so every request path was correct and
 * the defect was invisible from them. The internal readers - AI config,
 * credentials, the health report - have no request to state it from.
 * `resolveEffectiveLiferayConnection`, which already rejects a loopback host
 * and falls back to `LIFERAY_LXC_DXP_MAIN_DOMAIN`, ran exactly once in that
 * whole run because nothing on those paths called it. See #1175.
 */
const CX_ROOT = path.resolve(__dirname, '..');

// Two separate conditions, and conflating them made the first version of the
// loopback case unfalsifiable.
//
// `isLiferayRouteAvailable` selects the CREDENTIAL branch - it says the routes
// tree supplied the client id and secret. It does not turn on the loopback
// guard, and liferayEnv.cjs:108 records that these were deliberately split
// after being conflated once before.
//
// `isUsableLiferayUrl` rejects a loopback host only when
// `isColocatedDeployment()` is true, and that is `fs.existsSync(
// ENV.LIFERAY_ROUTES_DXP)` - a directory that must exist. The first version
// of this file deleted that variable, so the guard was off for the whole
// test: replacing the entire loopback branch with `if (false)` left all three
// cases green. See #1175.
const colocatedOauth = () => ({ isLiferayRouteAvailable: () => true });

/** A real directory, because the guard tests the filesystem, not a flag. */
function routesTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-routes-'));
  fs.writeFileSync(
    path.join(dir, 'com.liferay.lxc.dxp.main.domain'),
    'localhost'
  );
  return dir;
}

const LXC_KEYS = [
  'LIFERAY_LXC_DXP_MAIN_DOMAIN',
  'LIFERAY_LXC_DXP_DOMAINS',
  'LIFERAY_ROUTES_DXP',
  'LIFERAY_ROUTES_CLIENT_EXTENSION',
  'LIFERAY_API_URL',
  'LIFERAY_URL',
];

function freshConfigService(env) {
  // The whole COM_LIFERAY_LXC_* family too: config-node mangles dotted keys
  // into that shape, and a workstation exporting them made #1158 pass here
  // and fail in CI.
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('COM_LIFERAY_LXC_') || LXC_KEYS.includes(key)) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  Object.assign(process.env, env);

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(CX_ROOT) && !key.includes('node_modules')) {
      delete require.cache[key];
    }
  }

  const ConfigService = require('../services/configService.cjs');
  return {
    ConfigService,
    restore: () => {
      for (const key of Object.keys(env)) delete process.env[key];
      Object.assign(process.env, saved);
    },
  };
}

describe('a caller that states no target still gets a reachable one (#1175)', () => {
  test('an unstated target resolves to the LXC domain, not the tree loopback', () => {
    const dir = routesTree();
    const { ConfigService, restore } = freshConfigService({
      LIFERAY_LXC_DXP_MAIN_DOMAIN: 'aica-e2e.demo',
      LIFERAY_LXC_DXP_DOMAINS: 'aica-e2e.demo',
      LIFERAY_LXC_DXP_SERVER_PROTOCOL: 'https',
      // Present, so `isColocatedDeployment()` is true and the loopback
      // rejection is actually in force. Without it this case passed with the
      // guard disabled.
      LIFERAY_ROUTES_DXP: dir,
    });

    try {
      const service = new ConfigService({
        cache: new Map(),
        logger: { debug() {}, warn() {}, info() {} },
        oauth: colocatedOauth(),
      });

      // No request, so no stated URL - the shape every internal reader has.
      const { connection, description } = service._configurationSource({});

      expect(connection?.liferayUrl).toBeTruthy();
      expect(connection.liferayUrl).not.toMatch(/localhost|127\.0\.0\.1/);
      expect(connection.liferayUrl).toContain('aica-e2e.demo');
      // The description is what gets logged and cache-keyed, so it has to
      // agree with what was actually used.
      expect(description.liferayUrl).toBe(connection.liferayUrl);
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a loopback candidate is rejected when colocated, and kept when not', () => {
    // The assertion above only says the answer is not loopback. This says the
    // guard is what makes that true, by running the same input both ways.
    const dir = routesTree();
    const both = [];

    for (const routes of [dir, path.join(dir, 'does-not-exist')]) {
      const { ConfigService, restore } = freshConfigService({
        LIFERAY_LXC_DXP_MAIN_DOMAIN: 'aica-e2e.demo',
        LIFERAY_LXC_DXP_SERVER_PROTOCOL: 'https',
        LIFERAY_ROUTES_DXP: routes,
      });
      try {
        const { isUsableLiferayUrl } = require('../utils/liferayEnv.cjs');
        both.push(isUsableLiferayUrl('https://localhost'));
      } finally {
        restore();
      }
    }

    fs.rmSync(dir, { recursive: true, force: true });

    // Colocated: rejected. Not colocated: kept, because a host process talking
    // to a local Liferay is the case the guard must not break (#1137).
    expect(both).toEqual([false, true]);
  });

  test('a stated target is left exactly as the caller gave it', () => {
    const { ConfigService, restore } = freshConfigService({
      LIFERAY_LXC_DXP_MAIN_DOMAIN: 'aica-e2e.demo',
    });

    try {
      const service = new ConfigService({
        cache: new Map(),
        logger: { debug() {}, warn() {}, info() {} },
        oauth: colocatedOauth(),
      });

      const stated = { liferayUrl: 'https://someone-elses.example.com' };
      const { connection } = service._configurationSource(stated);

      // The dashboard path. Inferring over a stated target would silently
      // retarget a request at the wrong instance.
      expect(connection.liferayUrl).toBe('https://someone-elses.example.com');
    } finally {
      restore();
    }
  });

  test('colocated with nothing usable, it returns null rather than a loopback', () => {
    // The first version of this case ran with no routes tree, so it was not
    // colocated, and `http://localhost` was the *correct* answer there - a
    // host process talking to a local Liferay. It passed only because the
    // resolver threw for a different reason entirely. The dangerous case is
    // this one: colocated, and nothing reachable to fall back to.
    const dir = routesTree();
    const { ConfigService, restore } = freshConfigService({
      LIFERAY_ROUTES_DXP: dir,
    });

    try {
      const service = new ConfigService({
        cache: new Map(),
        logger: { debug() {}, warn() {}, info() {} },
        oauth: colocatedOauth(),
      });

      const { connection } = service._configurationSource({});

      // A guessed host would be worse than none: the SDK's own fallback and
      // the caller's error are both more informative than a wrong answer
      // that looks deliberate. See #1132.
      expect(connection?.liferayUrl ?? null).toBeNull();
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
