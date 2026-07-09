const CacheService = require('../services/cacheService.cjs');

describe('CacheService', () => {
  let cacheService;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      config: {
        getCacheConfigCached: vi.fn().mockReturnValue({}),
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
    };
    cacheService = new CacheService(mockCtx);
  });

  afterEach(() => {
    cacheService.clear();
  });

  it('should set and get a value', () => {
    cacheService.set('foo', 'bar');
    expect(cacheService.get('foo')).toBe('bar');
  });

  it('should return null for expired entries (manual mock)', () => {
    cacheService.set('foo', 'bar', 1000);
    // Manually expire it in the internal map
    cacheService.ttlMap.set('foo', Date.now() - 1000);
    expect(cacheService.get('foo')).toBeNull();
  });

  it('should delete entries', () => {
    cacheService.set('foo', 'bar');
    cacheService.delete('foo');
    expect(cacheService.has('foo')).toBe(false);
  });

  it('should evict oldest entries when limit reached', () => {
    // Set a small max size for testing
    cacheService.maxSize = 2;

    cacheService.set('a', 1);
    // Add a tiny delay to ensure timestamps are different if the system is very fast
    // Actually, let's manually tweak timestamps to be sure
    cacheService.set('b', 2);

    // Manually make 'a' the oldest
    const entryA = cacheService.cache.get('a');
    entryA.timestamp = Date.now() - 1000;

    cacheService.set('c', 3); // Should trigger eviction

    expect(cacheService.has('a')).toBe(false);
    expect(cacheService.has('b')).toBe(true);
    expect(cacheService.has('c')).toBe(true);
  });

  it('should use the remember pattern', async () => {
    const fetcher = vi.fn().mockResolvedValue('fresh-data');

    // First call - should call fetcher
    const result1 = await cacheService.remember('key1', fetcher);
    expect(result1).toBe('fresh-data');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Second call - should return cached value
    const result2 = await cacheService.remember('key1', fetcher);
    expect(result2).toBe('fresh-data');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('should prevent cache stampede by returning the same promise for concurrent remember calls', async () => {
    let callCount = 0;
    const fetcher = () =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve('stampede-resolved'), 50);
      });

    const promise1 = cacheService.remember('stampede-key', fetcher);
    const promise2 = cacheService.remember('stampede-key', fetcher);

    expect(promise1).toBe(promise2);

    const [val1, val2] = await Promise.all([promise1, promise2]);
    expect(val1).toBe('stampede-resolved');
    expect(val2).toBe('stampede-resolved');
    expect(callCount).toBe(1);
  });

  it('should return stats', () => {
    cacheService.set('a', { val: 1 });
    const stats = cacheService.getStats();
    expect(stats.size).toBe(1);
    expect(stats.totalSize).toBeGreaterThan(0);
  });
});
