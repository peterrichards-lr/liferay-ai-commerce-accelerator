const CacheService = require('../services/cacheService.cjs');
const { ENV } = require('../utils/constants.cjs');

/**
 * A caller's TTL is honoured, shorter or longer than the cache's own default.
 *
 * `set` used to compute `Math.max(this.defaultTTL, Number(ttl) || defaultTTL)`,
 * so a per-entry TTL below the global default was floored away. An entry asking
 * to live five minutes lived an hour, silently - and `CONFIG_CACHE_TTL` could
 * not shorten the configuration cache no matter what it was set to, only
 * lengthen it (#1075).
 *
 * These assert expiry rather than the computed number, because the number was
 * never the thing that mattered. Time is moved with fake timers rather than
 * waited out.
 */
// The default is set on the instance rather than through the environment:
// CACHE_DEFAULT_TTL is not declared in ENV on this branch (#1068 does that),
// so setting the variable would not reach the constructor. What is under test
// is how `set` treats the TTL it is handed, which this exercises either way.
function makeCache(defaultTTL) {
  const cache = new CacheService({ logger: undefined });
  cache.defaultTTL = defaultTTL;
  return cache;
}

describe('a cache entry lives as long as its caller asked', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires on a TTL shorter than the cache default', () => {
    // The case the floor made impossible.
    const cache = makeCache(3600000);
    cache.set('short', 'value', 5000);

    expect(cache.get('short')).toBe('value');

    vi.advanceTimersByTime(6000);

    expect(cache.get('short')).toBeNull();
  });

  it('still holds it until that shorter TTL is reached', () => {
    const cache = makeCache(3600000);
    cache.set('short', 'value', 5000);

    vi.advanceTimersByTime(4000);

    expect(cache.get('short')).toBe('value');
  });

  it('honours a TTL longer than the default too', () => {
    const cache = makeCache(1000);
    cache.set('long', 'value', 60000);

    vi.advanceTimersByTime(30000);

    expect(cache.get('long')).toBe('value');
  });

  it('falls back to the default when no TTL is given', () => {
    const cache = makeCache(10000);
    cache.set('none', 'value');

    vi.advanceTimersByTime(9000);
    expect(cache.get('none')).toBe('value');

    vi.advanceTimersByTime(2000);
    expect(cache.get('none')).toBeNull();
  });

  // The pair this change exists for. #1068 declared CONFIG_CACHE_TTL; without
  // the floor removed it could only ever lengthen the configuration cache,
  // because every configService call site passes it into `set`. Asserted here
  // rather than described, since the two changes are separately reviewable and
  // it is their combination that an operator sees.
  it('lets CONFIG_CACHE_TTL shorten the configuration cache', () => {
    const cache = makeCache(3600000);
    cache.set('config:ai', { provider: 'openai' }, ENV.CONFIG_CACHE_TTL);

    expect(ENV.CONFIG_CACHE_TTL).toBeLessThan(cache.defaultTTL);

    vi.advanceTimersByTime(ENV.CONFIG_CACHE_TTL - 1000);
    expect(cache.get('config:ai')).toEqual({ provider: 'openai' });

    vi.advanceTimersByTime(2000);
    expect(cache.get('config:ai')).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['a negative', -5000],
    ['not a number', 'soon'],
  ])('falls back rather than expiring instantly on %s TTL', (_label, ttl) => {
    // Each of these would mean "already expired" if taken literally, which is
    // not what a caller passing a broken value is asking for.
    const cache = makeCache(10000);
    cache.set('bad', 'value', ttl);

    vi.advanceTimersByTime(1000);

    expect(cache.get('bad')).toBe('value');
  });
});
