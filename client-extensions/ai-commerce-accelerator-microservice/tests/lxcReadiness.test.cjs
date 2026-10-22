const fs = require('fs');
const os = require('os');
const path = require('path');

const { clearCache, lookupConfig } = require('@rotty3000/config-node');

const {
  DXP_MAIN_DOMAIN_KEY,
  DXP_SERVER_PROTOCOL_KEY,
  forgetResolvedLiferayUrl,
  isDxpConfigTreeReady,
  readDxpAddress,
  startDxpConfigTreeWatcher,
} = require('../utils/lxcReadiness.cjs');

function tmpTree() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lxc-tree-'));
}

function writeKey(dir, contents, key = DXP_MAIN_DOMAIN_KEY) {
  fs.writeFileSync(path.join(dir, key), contents);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('LXC config tree readiness (#1103)', () => {
  const made = [];

  afterEach(() => {
    while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
  });

  const dir = () => {
    const d = tmpTree();
    made.push(d);
    return d;
  };

  describe('isDxpConfigTreeReady', () => {
    test('a populated key file is ready', () => {
      const d = dir();
      writeKey(d, 'aica-e2e.demo');
      expect(isDxpConfigTreeReady(d)).toBe(true);
    });

    // The case that makes the difference between resolving and caching a
    // second miss: the tree exists but Liferay has not finished writing it.
    test('an empty key file is NOT ready', () => {
      const d = dir();
      writeKey(d, '');
      expect(isDxpConfigTreeReady(d)).toBe(false);
    });

    test('a mounted but empty directory is not ready', () => {
      expect(isDxpConfigTreeReady(dir())).toBe(false);
    });

    test('an absent directory is not ready, and does not throw', () => {
      expect(isDxpConfigTreeReady('/no/such/tree')).toBe(false);
    });
  });

  describe('startDxpConfigTreeWatcher', () => {
    test('does not watch when nothing is mounted - the local case', () => {
      expect(startDxpConfigTreeWatcher({ dir: '/no/such/tree' })).toBeNull();
    });

    test('settles ready when the tree is already populated', async () => {
      const d = dir();
      writeKey(d, 'aica-e2e.demo');
      const w = startDxpConfigTreeWatcher({ dir: d });
      await expect(w.settled).resolves.toMatchObject({ ready: true });
    });

    test('settles ready once the key file appears, not before', async () => {
      const d = dir();
      let readyAt = null;
      const w = startDxpConfigTreeWatcher({
        dir: d,
        intervalMs: 100,
        timeoutMs: 5000,
        onReady: () => {
          readyAt = Date.now();
        },
      });

      expect(readyAt).toBeNull();
      setTimeout(() => writeKey(d, 'aica-e2e.demo'), 150);

      const outcome = await w.settled;
      expect(outcome.ready).toBe(true);
      expect(readyAt).not.toBeNull();
    });

    // Bounded, and boot survives it. The tree is written when Liferay's main
    // servlet is first hit; a deployment where that never happens must still
    // start, which is why this settles rather than throws.
    test('gives up after the timeout without throwing', async () => {
      const w = startDxpConfigTreeWatcher({
        dir: dir(),
        intervalMs: 20,
        timeoutMs: 60,
      });
      const outcome = await w.settled;
      expect(outcome.ready).toBe(false);
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(60);
    });
  });

  // Liferay rewrites the tree: its first write records the container port,
  // `aica-e2e.demo:8080`, and the proxied address replaces it later. Keeping
  // the first value sent every Liferay call to a port the node does not
  // publish, and Traefik dropped the unhealthy extension's router. See #1373.
  describe('following rewrites (#1373)', () => {
    const watchers = [];

    afterEach(() => {
      while (watchers.length) watchers.pop().stop();
    });

    const watch = (d, options) => {
      const w = startDxpConfigTreeWatcher({
        dir: d,
        intervalMs: 20,
        timeoutMs: 2000,
        ...options,
      });
      watchers.push(w);
      return w;
    };

    test('readDxpAddress is the protocol and domain, or null mid-write', () => {
      const d = dir();
      expect(readDxpAddress(d)).toBeNull();
      writeKey(d, '');
      expect(readDxpAddress(d)).toBeNull();
      writeKey(d, 'aica-e2e.demo:8080\n');
      writeKey(d, 'https', DXP_SERVER_PROTOCOL_KEY);
      expect(readDxpAddress(d)).toBe('https://aica-e2e.demo:8080');
    });

    test('reports the rewrite from the container port to the real host', async () => {
      const d = dir();
      writeKey(d, 'aica-e2e.demo:8080');
      writeKey(d, 'https', DXP_SERVER_PROTOCOL_KEY);
      const changes = [];
      const w = watch(d, { onChange: (c) => changes.push(c) });
      await w.settled;

      writeKey(d, 'aica-e2e.demo');
      await pause(120);

      expect(changes).toEqual([
        {
          previous: 'https://aica-e2e.demo:8080',
          current: 'https://aica-e2e.demo',
        },
      ]);
    });

    test('an unchanged tree causes no clear', async () => {
      const d = dir();
      writeKey(d, 'aica-e2e.demo');
      const changes = [];
      const w = watch(d, { onChange: (c) => changes.push(c) });
      await w.settled;

      writeKey(d, 'aica-e2e.demo');
      await pause(120);

      expect(changes).toEqual([]);
    });

    // Clearing towards an empty file would cache a miss, the #1103 failure.
    test('a mid-write empty file is not a change; the finished write is', async () => {
      const d = dir();
      writeKey(d, 'aica-e2e.demo:8080');
      const changes = [];
      const w = watch(d, { onChange: (c) => changes.push(c) });
      await w.settled;

      writeKey(d, '');
      await pause(120);
      expect(changes).toEqual([]);

      writeKey(d, 'aica-e2e.demo');
      await pause(120);
      expect(changes.map((c) => c.current)).toEqual(['://aica-e2e.demo']);
    });

    test('stop ends the following without reporting the tree as unreadable', async () => {
      const d = dir();
      writeKey(d, 'aica-e2e.demo:8080');
      const warnings = [];
      const changes = [];
      const w = watch(d, {
        logger: { info: () => {}, warn: (m) => warnings.push(m) },
        onChange: (c) => changes.push(c),
      });
      await w.settled;

      w.stop();
      writeKey(d, 'aica-e2e.demo');
      await pause(120);

      expect(changes).toEqual([]);
      expect(warnings.filter((m) => /not readable/.test(m))).toEqual([]);
    });

    // Against config-node itself rather than a stand-in for it: the defect was
    // its cache, so only the real cache can show the fix.
    test('the next config-node lookup sees the rewritten domain', async () => {
      const d = dir();
      const saved = process.env.CONFIG_NODE_CONFIG_TREES;
      process.env.CONFIG_NODE_CONFIG_TREES = d;
      clearCache();

      try {
        writeKey(d, 'aica-e2e.demo:8080');
        expect(lookupConfig(DXP_MAIN_DOMAIN_KEY)).toBe('aica-e2e.demo:8080');

        writeKey(d, 'aica-e2e.demo');
        // The defect, reproduced: the cache still answers with the first write.
        expect(lookupConfig(DXP_MAIN_DOMAIN_KEY)).toBe('aica-e2e.demo:8080');

        // Replay Liferay's order under the watcher: the container-port write,
        // a lookup that caches it, then the proxied address.
        const w = watch(d);
        await w.settled;
        writeKey(d, 'aica-e2e.demo:8080');
        await pause(120);
        lookupConfig(DXP_MAIN_DOMAIN_KEY);
        writeKey(d, 'aica-e2e.demo');
        await pause(120);

        expect(lookupConfig(DXP_MAIN_DOMAIN_KEY)).toBe('aica-e2e.demo');
      } finally {
        if (saved === undefined) delete process.env.CONFIG_NODE_CONFIG_TREES;
        else process.env.CONFIG_NODE_CONFIG_TREES = saved;
        clearCache();
      }
    });
  });

  // The second cache: the SDK's OAuth service keeps its first resolved URL.
  // Clearing config-node alone left 3,268 calls on the old address. #1373.
  describe('the OAuth service forgets the address it resolved (#1373)', () => {
    const { OAuthService } = require('@liferay/accelerator-sdk');

    test('liferayUrl and tokenEndpoint follow a rewrite once forgotten', () => {
      const d = dir();
      const saved = process.env.CONFIG_NODE_CONFIG_TREES;
      process.env.CONFIG_NODE_CONFIG_TREES = d;
      clearCache();

      try {
        writeKey(d, 'aica-e2e.demo:8080');
        writeKey(d, 'https', DXP_SERVER_PROTOCOL_KEY);
        const oauth = new OAuthService({});
        expect(oauth.liferayUrl).toBe('https://aica-e2e.demo:8080');

        writeKey(d, 'aica-e2e.demo');
        clearCache();
        // The defect: config-node is fresh, the service is not.
        expect(oauth.liferayUrl).toBe('https://aica-e2e.demo:8080');

        forgetResolvedLiferayUrl(oauth);

        expect(oauth.liferayUrl).toBe('https://aica-e2e.demo');
        expect(oauth.tokenEndpoint).toBe(
          'https://aica-e2e.demo/o/oauth2/token'
        );
      } finally {
        if (saved === undefined) delete process.env.CONFIG_NODE_CONFIG_TREES;
        else process.env.CONFIG_NODE_CONFIG_TREES = saved;
        clearCache();
      }
    });

    test('tolerates no service', () => {
      expect(() => forgetResolvedLiferayUrl(undefined)).not.toThrow();
    });

    test('bootstrap wires it to the watcher', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'bootstrap.cjs'),
        'utf8'
      );
      expect(source).toMatch(
        /startDxpConfigTreeWatcher\(\{[^}]*onChange: \(\) => forgetResolvedLiferayUrl\(ctx\.oauth\)/s
      );
    });
  });

  // LDM is moving where LIFERAY_ROUTES_DXP points - the mount rises to
  // `routes`, the variable drops to `routes/default/dxp`. That turns our
  // default from unused into dangerous: unset, we would quietly assume the old
  // convention, find nothing, and it would look like the upstream change
  // failing. See liferay-docker-manager#1944.
  describe('the path fallback announces itself', () => {
    const warnings = [];
    const logger = { warn: (m) => warnings.push(m), debug: () => {} };

    beforeEach(() => {
      warnings.length = 0;
      delete require.cache[require.resolve('../utils/lxcReadiness.cjs')];
    });

    test('warns once when the variable is unset', () => {
      const saved = process.env.LIFERAY_ROUTES_DXP;
      delete process.env.LIFERAY_ROUTES_DXP;

      try {
        const { warnIfPathIsAGuess } = require('../utils/lxcReadiness.cjs');
        warnIfPathIsAGuess(logger);
        warnIfPathIsAGuess(logger);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/LIFERAY_ROUTES_DXP is not set/);
        // Names the consequence, not just the condition.
        expect(warnings[0]).toMatch(/this, not a missing tree/);
      } finally {
        if (saved === undefined) delete process.env.LIFERAY_ROUTES_DXP;
        else process.env.LIFERAY_ROUTES_DXP = saved;
      }
    });

    test('stays quiet when the environment supplies the path', () => {
      const saved = process.env.LIFERAY_ROUTES_DXP;
      process.env.LIFERAY_ROUTES_DXP = '/etc/liferay/lxc/routes/default/dxp';

      try {
        const { warnIfPathIsAGuess } = require('../utils/lxcReadiness.cjs');
        warnIfPathIsAGuess(logger);
        expect(warnings).toHaveLength(0);
      } finally {
        if (saved === undefined) delete process.env.LIFERAY_ROUTES_DXP;
        else process.env.LIFERAY_ROUTES_DXP = saved;
      }
    });
  });
});
