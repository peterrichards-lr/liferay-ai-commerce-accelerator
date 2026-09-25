const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DXP_MAIN_DOMAIN_KEY,
  isDxpConfigTreeReady,
  startDxpConfigTreeWatcher,
} = require('../utils/lxcReadiness.cjs');

function tmpTree() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lxc-tree-'));
}

function writeKey(dir, contents) {
  fs.writeFileSync(path.join(dir, DXP_MAIN_DOMAIN_KEY), contents);
}

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
