const CacheService = require('../services/cacheService.cjs');
const { QueueService } = require('../services/queueService.cjs');
const { normalizeOptionalNumber } = require('../utils/misc.cjs');

/**
 * `applyConfig` used to fold every incoming field with `Math.max`, so the
 * Cache and Queue panels could raise a setting and never lower one. The reason
 * to open either panel is usually to reduce something - a smaller cache, less
 * concurrency - which was the one thing they could not do. See #1271.
 *
 * Each case states its precondition with `toBeLessThan` first, so a change to
 * the defaults turns these into failures rather than into assertions that pass
 * without exercising anything.
 */

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
  success: vi.fn(),
});

describe('a lower value is a value (#1271)', () => {
  describe('normalizeOptionalNumber', () => {
    const options = { min: 100, defaultValue: 10000 };

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', ''],
      ['whitespace', '   '],
    ])('keeps the current setting when the field holds %s', (_label, value) => {
      expect(normalizeOptionalNumber(value, options)).toBe(10000);
    });

    it('takes a supplied value that is lower than the current setting', () => {
      expect(normalizeOptionalNumber(999, options)).toBe(999);
    });

    it('still clamps a supplied value to the floor', () => {
      expect(normalizeOptionalNumber(5, options)).toBe(100);
    });

    it('reads a numeric string as the number it spells', () => {
      expect(normalizeOptionalNumber('250', options)).toBe(250);
    });
  });

  describe('CacheService', () => {
    let cacheService;

    beforeEach(() => {
      cacheService = new CacheService({
        config: { getCacheConfigCached: vi.fn().mockReturnValue({}) },
        logger: silentLogger(),
      });
    });

    afterEach(() => {
      clearInterval(cacheService._cleanupTimer);
      cacheService.clear();
    });

    it('shrinks the cache when the panel asks for a smaller one', () => {
      expect(999).toBeLessThan(cacheService.maxSize);
      cacheService.applyConfig({ maxSize: 999 });
      expect(cacheService.maxSize).toBe(999);
    });

    it('shortens the default TTL when the panel asks for a shorter one', () => {
      expect(111000).toBeLessThan(cacheService.defaultTTL);
      cacheService.applyConfig({ defaultTTL: 111000 });
      expect(cacheService.defaultTTL).toBe(111000);
    });

    it('lowers every field at once', () => {
      const lowered = {
        maxSize: 500,
        defaultTTL: 60000,
        cleanupInterval: 10000,
      };
      expect(lowered.maxSize).toBeLessThan(cacheService.maxSize);
      expect(lowered.defaultTTL).toBeLessThan(cacheService.defaultTTL);
      expect(lowered.cleanupInterval).toBeLessThan(
        cacheService.cleanupIntervalMs
      );

      cacheService.applyConfig(lowered);

      expect(cacheService.maxSize).toBe(lowered.maxSize);
      expect(cacheService.defaultTTL).toBe(lowered.defaultTTL);
      expect(cacheService.cleanupIntervalMs).toBe(lowered.cleanupInterval);
    });

    it('re-arms the cleanup timer on the shorter interval', () => {
      const before = cacheService._cleanupTimer;
      cacheService.applyConfig({ cleanupInterval: 10000 });
      expect(cacheService._cleanupTimer).not.toBe(before);
    });

    it('holds a value below the floor at the floor, not at the current one', () => {
      cacheService.applyConfig({ maxSize: 1 });
      expect(cacheService.maxSize).toBe(100);
    });

    it('leaves a field the panel did not fill in alone', () => {
      const { maxSize, defaultTTL } = cacheService;
      cacheService.applyConfig({ maxSize: null, defaultTTL: '' });
      expect(cacheService.maxSize).toBe(maxSize);
      expect(cacheService.defaultTTL).toBe(defaultTTL);
    });

    it('leaves every field alone when the read came back empty', () => {
      const before = { ...cacheService };
      cacheService.applyConfig({});
      expect(cacheService.maxSize).toBe(before.maxSize);
      expect(cacheService.defaultTTL).toBe(before.defaultTTL);
      expect(cacheService.cleanupIntervalMs).toBe(before.cleanupIntervalMs);
    });
  });

  describe('QueueService', () => {
    let queueService;

    beforeEach(() => {
      queueService = new QueueService({
        logger: silentLogger(),
        cache: { set: vi.fn(), get: vi.fn() },
        config: {
          getQueueConfigCached: vi.fn().mockReturnValue({}),
          getQueueConfig: vi.fn(),
        },
        persistence: {
          saveQueueJob: vi.fn(),
          deleteQueueJob: vi.fn(),
          getPendingQueueJobs: vi.fn().mockReturnValue([]),
          db: { name: 'test.db' },
        },
      });
    });

    afterEach(async () => {
      if (queueService?.backgroundWorker) {
        await queueService.backgroundWorker.terminate();
      }
    });

    it('lowers the default concurrency, the reason to open the panel', () => {
      expect(1).toBeLessThan(queueService.settings.defaults.concurrency);
      queueService.applyConfig({ concurrency: 1 });
      expect(queueService.settings.defaults.concurrency).toBe(1);
    });

    it('lowers every default at once', () => {
      const lowered = {
        concurrency: 1,
        maxRetries: 1,
        retryDelay: 1000,
        jobTimeout: 10000,
        cleanupInterval: 60000,
        jobTTL: 60000,
      };
      const current = queueService.settings.defaults;
      expect(lowered.concurrency).toBeLessThan(current.concurrency);
      expect(lowered.maxRetries).toBeLessThan(current.maxRetries);
      expect(lowered.retryDelay).toBeLessThan(current.retryDelay);
      expect(lowered.jobTimeout).toBeLessThan(current.jobTimeout);
      expect(lowered.cleanupInterval).toBeLessThan(current.cleanupInterval);
      expect(lowered.jobTTL).toBeLessThan(current.jobTTL);

      queueService.applyConfig(lowered);

      expect(queueService.settings.defaults).toMatchObject(lowered);
    });

    it('reads the same fields nested under `defaults`', () => {
      expect(1).toBeLessThan(queueService.settings.defaults.concurrency);
      queueService.applyConfig({ defaults: { concurrency: 1 } });
      expect(queueService.settings.defaults.concurrency).toBe(1);
    });

    it('lowers a single queue without touching the defaults', () => {
      queueService.applyConfig({
        queues: { 'data-generation': { concurrency: 9 } },
      });
      expect(queueService.settings.byQueue['data-generation'].concurrency).toBe(
        9
      );

      queueService.applyConfig({
        queues: { 'data-generation': { concurrency: 1 } },
      });
      expect(queueService.settings.byQueue['data-generation'].concurrency).toBe(
        1
      );
    });

    it('holds a default below the floor at the floor', () => {
      queueService.applyConfig({ retryDelay: 1 });
      expect(queueService.settings.defaults.retryDelay).toBe(1000);
    });

    it('leaves a field the panel did not fill in alone', () => {
      const { concurrency, jobTTL } = queueService.settings.defaults;
      queueService.applyConfig({ concurrency: null, jobTTL: '' });
      expect(queueService.settings.defaults.concurrency).toBe(concurrency);
      expect(queueService.settings.defaults.jobTTL).toBe(jobTTL);
    });

    it('leaves every default alone when the read came back empty', () => {
      const before = { ...queueService.settings.defaults };
      queueService.applyConfig({});
      expect(queueService.settings.defaults).toEqual(before);
    });
  });
});
