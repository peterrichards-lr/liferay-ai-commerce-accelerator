const CacheService = require('../services/cacheService.cjs');
const { QueueService } = require('../services/queueService.cjs');
const { startConfigRefresh } = require('../utils/configRefresh.cjs');

/**
 * The Cache and Queue Configuration panels, connected to their services.
 *
 * Both wrote their object entry, both reloaded showing the new value, and
 * neither reached the service - the same end as #1243, by two different
 * routes:
 *
 *   CacheService  built at the top of bootstrap, before `ctx.config` exists,
 *                 so the constructor's `this.ctx.config` guard never passed.
 *   QueueService  built late enough, but `this.config` held the config
 *                 service and then its own settings, and the second
 *                 assignment won, so the read was made against an object with
 *                 no `getQueueConfigCached` on it.
 *
 * Every case lowers a value rather than raising one. Until #1271 `applyConfig`
 * took `Math.max` of the current and incoming value, so a guard written with a
 * higher number passed whether or not any of this worked.
 *
 * See #1270.
 */

const quiet = () => ({
  debug() {},
  info() {},
  warn() {},
  error() {},
  trace() {},
  success() {},
});

describe('the Cache and Queue panels reach their services (#1270)', () => {
  describe('CacheService', () => {
    const LOWERED = { maxSize: 999, defaultTTL: 111000 };

    const asBootstrapBuildsIt = () => new CacheService({ logger: quiet() }); // no `config`, deliberately

    const fakeConfigService = () => ({
      getCacheConfig: async () => LOWERED,
      getCacheConfigCached: () => LOWERED,
    });

    let started = [];
    const start = (ctx, service) => {
      const handle = startConfigRefresh(ctx, {
        service,
        subject: 'Cache settings',
        operation: 'cache-config-refresh',
        intervalMs: 60_000,
      });
      started.push(handle);
      return handle;
    };

    afterEach(() => {
      started.forEach((handle) => handle.stop());
      started = [];
    });

    test('is built without a config service, exactly as bootstrap does', () => {
      // The defect itself. If this ever fails the ordering changed, and the
      // rest of this block is testing something that no longer happens.
      expect(asBootstrapBuildsIt().ctx.config).toBeUndefined();
    });

    test('is handed the config service it was built without', () => {
      const cache = asBootstrapBuildsIt();
      const config = fakeConfigService();

      start({ config, logger: quiet() }, cache);

      expect(cache.ctx.config).toBe(config);
      clearInterval(cache._cleanupTimer);
    });

    test('a lowered maxSize reaches the cache', async () => {
      const cache = asBootstrapBuildsIt();
      expect(LOWERED.maxSize).toBeLessThan(cache.maxSize);

      const handle = start(
        { config: fakeConfigService(), logger: quiet() },
        cache
      );
      await handle.refreshNow();

      expect(cache.maxSize).toBe(LOWERED.maxSize);
      clearInterval(cache._cleanupTimer);
    });

    test('a lowered defaultTTL reaches the cache', async () => {
      const cache = asBootstrapBuildsIt();
      expect(LOWERED.defaultTTL).toBeLessThan(cache.defaultTTL);

      const handle = start(
        { config: fakeConfigService(), logger: quiet() },
        cache
      );
      await handle.refreshNow();

      expect(cache.defaultTTL).toBe(LOWERED.defaultTTL);
      clearInterval(cache._cleanupTimer);
    });

    test('without waiting for the first interval', async () => {
      const cache = asBootstrapBuildsIt();

      start({ config: fakeConfigService(), logger: quiet() }, cache);
      await new Promise((resolve) => setImmediate(resolve));

      expect(cache.maxSize).toBe(LOWERED.maxSize);
      clearInterval(cache._cleanupTimer);
    });
  });

  describe('QueueService', () => {
    const LOWERED = { concurrency: 1, jobTimeout: 10000 };

    const build = (config) =>
      new QueueService({
        logger: quiet(),
        config,
        cache: { set() {}, get() {} },
        persistence: {
          saveQueueJob() {},
          deleteQueueJob() {},
          getPendingQueueJobs: () => [],
          db: { name: 'test.db' },
        },
      });

    const fakeConfigService = () => ({
      getQueueConfig: async () => LOWERED,
      getQueueConfigCached: () => LOWERED,
    });

    let queueService;

    afterEach(async () => {
      if (queueService?.backgroundWorker) {
        await queueService.backgroundWorker.terminate();
      }
      clearInterval(queueService?._cleanupTimer);
      queueService = undefined;
    });

    test('keeps the config service and its settings under separate names', () => {
      // The defect itself: one name held both, and the settings won.
      const config = fakeConfigService();
      queueService = build(config);

      expect(queueService.ctx.config).toBe(config);
      expect(queueService.settings).toHaveProperty('defaults');
      expect(queueService.settings).toHaveProperty('byQueue');
      expect(queueService.config).toBeUndefined();
    });

    test('the constructor cached read lowers the concurrency', () => {
      // `getQueueConfigCached` was called against the settings object, which
      // has no such method, so the guard never passed and nothing applied.
      queueService = build(fakeConfigService());

      expect(queueService.settings.defaults.concurrency).toBe(
        LOWERED.concurrency
      );
      expect(queueService.settings.defaults.jobTimeout).toBe(
        LOWERED.jobTimeout
      );
    });

    test('refreshes from the config service without being handed one', async () => {
      // This case used to need `queueService.config.getQueueConfig = ...` to
      // pass, which was the test working around the defect.
      const config = fakeConfigService();
      queueService = build(config);
      queueService.settings.defaults.concurrency = 8;

      await queueService.refreshConfigFromRemote({ correlationId: 'c' });

      expect(queueService.settings.defaults.concurrency).toBe(
        LOWERED.concurrency
      );
    });

    test('re-arms the cleanup timer when the interval changes', () => {
      queueService = build(fakeConfigService());
      const before = queueService._cleanupTimer;
      expect(before).toBeDefined();

      queueService.applyConfig({ cleanupInterval: 60000 });

      expect(queueService._cleanupTimer).not.toBe(before);
      expect(queueService.settings.defaults.cleanupInterval).toBe(60000);
    });
  });

  describe('when a service cannot follow its panel', () => {
    test('says so rather than doing nothing quietly', () => {
      // Silence here looks exactly like the defect being fixed.
      const warnings = [];
      const handle = startConfigRefresh(
        {
          config: {},
          logger: { ...quiet(), warn: (m) => warnings.push(m) },
        },
        {
          service: {},
          subject: 'Cache settings',
          operation: 'cache-config-refresh',
        }
      );

      try {
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(
          /Cache settings will not follow the configuration panel/
        );
      } finally {
        handle.stop();
      }
    });
  });
});
