const { ENV } = require('../utils/constants.cjs');
const { sanitizeCacheEntry } = require('../utils/normalize.cjs');
const { normalizeNumber } = require('../utils/misc.cjs');

class CacheService {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = new Map();
    this.ttlMap = new Map();
    this.maxSize = normalizeNumber(ENV.CACHE_MAX_SIZE, {
      min: 100,
      defaultValue: 1000,
    });
    this.defaultTTL = normalizeNumber(ENV.CACHE_DEFAULT_TTL, {
      min: 1000,
      defaultValue: 3600000,
    });
    this.cleanupIntervalMs = normalizeNumber(ENV.CACHE_CLEANUP_INTERVAL, {
      min: 5000,
      defaultValue: 60000,
    });
    this._cleanupTimer = null;

    const cfgSvc = this.ctx.configService;
    if (cfgSvc && typeof cfgSvc.getCacheConfigCached === 'function') {
      const cachedCfg = cfgSvc.getCacheConfigCached();
      this.applyConfig(cachedCfg);
    }

    this._setCleanupTimer(this.cleanupIntervalMs);
  }

  applyConfig(config = {}) {
    if (!config) return;
    const { logger } = this.ctx;

    let src = config;
    if (typeof config === 'string') {
      try {
        src = JSON.parse(config);
      } catch (_) {
        return;
      }
    }
    if (typeof src !== 'object') return;

    const next = {
      maxSize: normalizeNumber(src.maxSize, {
        min: 100,
        defaultValue: this.maxSize,
      }),
      defaultTTL: normalizeNumber(src.defaultTTL, {
        min: 1000,
        defaultValue: this.defaultTTL,
      }),
      cleanupIntervalMs: normalizeNumber(src.cleanupInterval, {
        min: 5000,
        defaultValue: this.cleanupIntervalMs,
      }),
    };

    this.maxSize = Math.max(this.maxSize, next.maxSize);
    this.defaultTTL = Math.max(this.defaultTTL, next.defaultTTL);
    this.cleanupIntervalMs = Math.max(
      this.cleanupIntervalMs,
      next.cleanupIntervalMs
    );

    this._setCleanupTimer(this.cleanupIntervalMs);

    logger?.debug?.('CacheService config applied', {
      operation: 'cache-config-apply',
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
      cleanupIntervalMs: this.cleanupIntervalMs,
    });
  }

  async refreshConfigFromRemote(requestConfig) {
    const { configService, logger } = this.ctx;
    if (!configService?.getCacheConfig) return;

    try {
      const remoteCfg = await configService.getCacheConfig(requestConfig);
      this.applyConfig(remoteCfg);
    } catch (e) {
      logger?.warn?.('CacheService: failed to refresh config from remote', {
        operation: 'cache-config-refresh',
        error: String(e?.message || e),
      });
    }
  }

  _setCleanupTimer(intervalMs) {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    this._cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
  }

  set(key, value, ttl = this.defaultTTL) {
    const { logger } = this.ctx;

    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const effectiveTtl = Math.max(
      this.defaultTTL,
      Number(ttl) || this.defaultTTL
    );
    const expiry = Date.now() + effectiveTtl;

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 0,
      size: this.calculateSize(value),
    });
    this.ttlMap.set(key, expiry);

    logger?.trace?.('Cache entry set', {
      operation: 'cache-set',
      key,
      ttl: effectiveTtl,
      cacheSize: this.cache.size,
    });
  }

  get(key) {
    const { logger } = this.ctx;
    const ttlEntry = this.ttlMap.get(key);

    if (!ttlEntry || Date.now() > ttlEntry) {
      this.delete(key);
      logger?.trace?.('Cache miss - expired', {
        operation: 'cache-get',
        key,
        result: 'expired',
      });
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      logger?.trace?.('Cache miss - not found', {
        operation: 'cache-get',
        key,
        result: 'not-found',
      });
      return null;
    }

    entry.accessCount++;
    entry.lastAccess = Date.now();

    logger?.trace?.('Cache hit', {
      operation: 'cache-get',
      key,
      result: 'hit',
      accessCount: entry.accessCount,
    });

    return entry.value;
  }

  delete(key) {
    const { logger } = this.ctx;
    const deleted = this.cache.delete(key);
    this.ttlMap.delete(key);

    if (deleted) {
      logger?.trace?.('Cache entry deleted', {
        operation: 'cache-delete',
        key,
        cacheSize: this.cache.size,
      });
    }
    return deleted;
  }

  has(key) {
    const ttlEntry = this.ttlMap.get(key);
    if (!ttlEntry || Date.now() > ttlEntry) {
      this.delete(key);
      return false;
    }
    return this.cache.has(key);
  }

  clear() {
    const { logger } = this.ctx;
    const size = this.cache.size;
    this.cache.clear();
    this.ttlMap.clear();

    logger?.info?.('Cache cleared', {
      operation: 'cache-clear',
      clearedEntries: size,
    });
  }

  cleanup() {
    const { logger } = this.ctx;
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, expiry] of this.ttlMap.entries()) {
      if (now > expiry) expiredKeys.push(key);
    }

    expiredKeys.forEach((key) => this.delete(key));

    if (expiredKeys.length > 0) {
      logger?.debug?.('Cache cleanup completed', {
        operation: 'cache-cleanup',
        expiredEntries: expiredKeys.length,
        remainingEntries: this.cache.size,
      });
    }
  }

  evictOldest() {
    const { logger } = this.ctx;
    if (this.cache.size === 0) return;

    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      logger?.debug?.('Cache entry evicted', {
        operation: 'cache-evict',
        key: oldestKey,
        reason: 'size-limit',
      });
    }
  }

  getStats(includeEntryValue = false) {
    const stats = {
      size: this.cache.size,
      maxSize: this.maxSize,
      entries: [],
    };

    let totalSize = 0;
    for (const [key, entry] of this.cache.entries()) {
      totalSize += entry.size;
      stats.entries.push(
        includeEntryValue
          ? sanitizeCacheEntry({
              key,
              size: entry.size,
              accessCount: entry.accessCount,
              age: Date.now() - entry.timestamp,
              lastAccess: entry.lastAccess,
              ttl: this.ttlMap.get(key) || 'Unknown',
              value: entry.value,
            })
          : {
              key,
              size: entry.size,
              accessCount: entry.accessCount,
              age: Date.now() - entry.timestamp,
              lastAccess: entry.lastAccess,
              ttl: this.ttlMap.get(key) || 'Unknown',
            }
      );
    }

    stats.totalSize = totalSize;
    stats.averageSize = stats.size > 0 ? totalSize / stats.size : 0;

    return stats;
  }

  calculateSize(value) {
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 1000;
    }
  }

  remember(key, asyncFunction, ttl = this.defaultTTL) {
    const cached = this.get(key);
    if (cached !== null) return Promise.resolve(cached);

    return asyncFunction().then((result) => {
      this.set(key, result, ttl);
      return result;
    });
  }

  cacheConfig(key, value, ttl = this.defaultTTL) {
    this.set(`config:${key}`, value, ttl);
  }

  getConfig(key) {
    return this.get(`config:${key}`);
  }

  cacheApiResponse(url, method, body, response, ttl = 300000) {
    const cacheKey = `api:${method}:${url}:${JSON.stringify(body)}`;
    this.set(cacheKey, response, ttl);
  }

  getApiResponse(url, method, body) {
    const cacheKey = `api:${method}:${url}:${JSON.stringify(body)}`;
    return this.get(cacheKey);
  }
}

module.exports = CacheService;
