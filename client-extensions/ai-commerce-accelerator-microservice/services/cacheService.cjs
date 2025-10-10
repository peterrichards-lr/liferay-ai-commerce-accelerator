const { logger } = require('../utils/logger.cjs');
const { env } = require('../utils/constants.cjs');
const { sanitizeCacheEntry } = require('../utils/normalize.cjs');

class CacheService {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = new Map();
    this.ttlMap = new Map();
    this.maxSize = env.CACHE_MAX_SIZE;
    this.defaultTTL = env.CACHE_DEFAULT_TTL;

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  set(key, value, ttl = this.defaultTTL) {
    const { logger } = this.ctx;
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const expiry = Date.now() + ttl;
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 0,
      size: this.calculateSize(value),
    });
    this.ttlMap.set(key, expiry);

    logger.trace('Cache entry set', {
      operation: 'cache-set',
      key,
      ttl,
      cacheSize: this.cache.size,
    });
  }

  get(key) {
    const { logger } = this.ctx;
    const ttlEntry = this.ttlMap.get(key);

    // Check if expired
    if (!ttlEntry || Date.now() > ttlEntry) {
      this.delete(key);
      logger.trace('Cache miss - expired', {
        operation: 'cache-get',
        key,
        result: 'expired',
      });
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      logger.trace('Cache miss - not found', {
        operation: 'cache-get',
        key,
        result: 'not-found',
      });
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccess = Date.now();

    logger.trace('Cache hit', {
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
      logger.trace('Cache entry deleted', {
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

    logger.info('Cache cleared', {
      operation: 'cache-clear',
      clearedEntries: size,
    });
  }

  cleanup() {
    const { logger } = this.ctx;
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, expiry] of this.ttlMap.entries()) {
      if (now > expiry) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach((key) => {
      this.delete(key);
    });

    if (expiredKeys.length > 0) {
      logger.debug('Cache cleanup completed', {
        operation: 'cache-cleanup',
        expiredEntries: expiredKeys.length,
        remainingEntries: this.cache.size,
      });
    }
  }

  evictOldest() {
    const { logger } = this.ctx;
    if (this.cache.size === 0) return;

    // Find the oldest entry by timestamp
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
      logger.debug('Cache entry evicted', {
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
      return JSON.stringify(value).length * 2; // Rough estimate in bytes
    } catch (error) {
      return 1000; // Default size estimate
    }
  }

  // Convenience methods for common caching patterns
  remember(key, asyncFunction, ttl = this.defaultTTL) {
    const cached = this.get(key);
    if (cached !== null) {
      return Promise.resolve(cached);
    }

    return asyncFunction().then((result) => {
      this.set(key, result, ttl);
      return result;
    });
  }

  // Cache configuration data
  cacheConfig(key, value, ttl = 3600000) {
    // 1 hour default for config
    this.set(`config:${key}`, value, ttl);
  }

  getConfig(key) {
    return this.get(`config:${key}`);
  }

  // Cache API responses
  cacheApiResponse(url, method, body, response, ttl = 300000) {
    // 5 minutes
    const cacheKey = `api:${method}:${url}:${JSON.stringify(body)}`;
    this.set(cacheKey, response, ttl);
  }

  getApiResponse(url, method, body) {
    const cacheKey = `api:${method}:${url}:${JSON.stringify(body)}`;
    return this.get(cacheKey);
  }
}

module.exports = CacheService;
