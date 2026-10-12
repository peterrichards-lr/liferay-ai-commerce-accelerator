const OAuthService = require('@liferay/accelerator-sdk/src/liferay/oauth.cjs');

const { startOAuthConfigRefresh } = require('../utils/oauthConfigRefresh.cjs');
const { ENV } = require('../utils/constants.cjs');

/**
 * The OAuth Configuration panel, connected to the OAuth client.
 *
 * Editing httpTimeoutMs, maxRetries, backoffBaseMs, tokenSkewSec or
 * tokenCacheTtlMs wrote the `oauth-config` entry, the panel reloaded showing
 * the new value, and the client went on using the old one - for the life of
 * the process and after a restart.
 *
 * `OAuthService` resolves the config service through `this.ctx.config`, and
 * bootstrap built it before `ctx.config` existed. The order cannot be
 * swapped: ConfigService takes `oauth` (#1175), so each needs the other.
 *
 * It was invisible because the seeded values equal the SDK's own defaults -
 * nothing misbehaves until somebody changes one, which is why every case here
 * changes one. See #1243.
 */
const quiet = () => ({ debug() {}, warn() {}, error() {}, trace() {} });

function fakeConfigService(oauthConfig) {
  return {
    getOAuthConfig: async () => oauthConfig,
    getOAuthConfigCached: () => oauthConfig,
  };
}

describe('the OAuth panel reaches the OAuth client (#1243)', () => {
  describe('the late wiring', () => {
    test('hands the config service to an OAuth service built without one', () => {
      // The defect exactly: constructed with no `config`, as bootstrap does.
      const oauth = new OAuthService({
        cache: new Map(),
        logger: quiet(),
        oauthApplicationExternalReferenceCode: 'X',
      });
      expect(oauth.ctx.config).toBeUndefined();

      const config = fakeConfigService({});
      const handle = startOAuthConfigRefresh(
        { oauth, config, logger: quiet() },
        { intervalMs: 60_000 }
      );

      try {
        expect(oauth.ctx.config).toBe(config);
      } finally {
        handle.stop();
      }
    });

    test('says so rather than doing nothing quietly, if it cannot refresh', () => {
      // Silence here would look exactly like the defect being fixed.
      const warnings = [];
      const handle = startOAuthConfigRefresh({
        oauth: {},
        logger: { ...quiet(), warn: (m) => warnings.push(m) },
      });

      try {
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/will not follow the configuration panel/);
      } finally {
        handle.stop();
      }
    });
  });

  describe('a changed value reaches the client', () => {
    // Below the defaults on purpose. Until accelerator-sdk#305 the SDK took
    // Math.max of the current and incoming value, so a guard written with a
    // HIGHER value passed whether or not any of this worked. A lowered value
    // is the only one that can fail.
    const LOWERED = {
      httpTimeoutMs: 9000,
      maxRetries: 0,
      backoffBaseMs: 200,
      tokenSkewSec: 10,
      tokenCacheTtlMs: 600000,
    };

    test('every one of the five, lowered', async () => {
      const oauth = new OAuthService({
        cache: new Map(),
        logger: quiet(),
        oauthApplicationExternalReferenceCode: 'X',
      });

      for (const [field, value] of Object.entries(LOWERED)) {
        expect(
          value,
          `${field} must be below the default or this cannot fail`
        ).toBeLessThan(oauth.settings[field]);
      }

      const handle = startOAuthConfigRefresh(
        { oauth, config: fakeConfigService(LOWERED), logger: quiet() },
        { intervalMs: 60_000 }
      );

      try {
        await handle.refreshNow();
        expect(oauth.settings).toEqual(LOWERED);
      } finally {
        handle.stop();
      }
    });

    test('without waiting for the first interval', async () => {
      // A panel that takes effect six minutes after boot is a different
      // defect wearing the same clothes.
      const oauth = new OAuthService({
        cache: new Map(),
        logger: quiet(),
        oauthApplicationExternalReferenceCode: 'X',
      });

      const handle = startOAuthConfigRefresh(
        { oauth, config: fakeConfigService(LOWERED), logger: quiet() },
        { intervalMs: 60_000 }
      );

      try {
        await new Promise((resolve) => setImmediate(resolve));
        expect(oauth.settings.httpTimeoutMs).toBe(LOWERED.httpTimeoutMs);
      } finally {
        handle.stop();
      }
    });
  });

  describe('the period', () => {
    test('matches the TTL of the cache it reads through', () => {
      // Faster re-reads the same cached value and reaches Liferay no sooner;
      // slower leaves the cache expired while the settings have not moved.
      const handle = startOAuthConfigRefresh({
        oauth: { ctx: {}, refreshConfigFromRemote: async () => {} },
        config: fakeConfigService({}),
        logger: quiet(),
      });

      try {
        expect(handle.intervalMs).toBe(ENV.CONFIG_CACHE_TTL);
      } finally {
        handle.stop();
      }
    });

    test('a failing refresh is reported, not thrown', async () => {
      // Bootstrap does not await the first refresh; an unhandled rejection
      // here would take the process down at boot on an unreachable Liferay.
      const warnings = [];
      const handle = startOAuthConfigRefresh(
        {
          oauth: {
            ctx: {},
            refreshConfigFromRemote: async () => {
              throw new Error('liferay is not up');
            },
          },
          config: fakeConfigService({}),
          logger: { ...quiet(), warn: (m) => warnings.push(m) },
        },
        { intervalMs: 60_000 }
      );

      try {
        await handle.refreshNow();
        expect(warnings.join(' ')).toMatch(/refresh failed/);
      } finally {
        handle.stop();
      }
    });
  });
});
