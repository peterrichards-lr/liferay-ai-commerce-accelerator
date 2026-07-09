const { ENV } = require('../utils/constants.cjs');
const { sanitizeCacheEntry } = require('../utils/normalize.cjs');
const {
  normalizeNumber,
  isJSON,
  tryParseJSON,
  createERC,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class CacheService {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = new Map();
    this.ttlMap = new Map();
    this.pendingPromises = new Map();
    this.maxSize = normalizeNumber(ENV.CACHE_MAX_SIZE, {
      min: 100,
      defaultValue: 10000,
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

    const cfgSvc = this.ctx.config;
    if (cfgSvc && typeof cfgSvc.getCacheConfigCached === 'function') {
      const cachedCfg = cfgSvc.getCacheConfigCached();
      this.applyConfig(cachedCfg);
    }

    this._setCleanupTimer(this.cleanupIntervalMs);
  }

  _normalizeRequestBodyForCache(body) {
    if (body == null) return '';
    if (typeof body === 'string') {
      if (isJSON(body)) {
        const parsed = tryParseJSON(body, body);
        return JSON.stringify(parsed);
      }
      return body;
    }
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }

  applyConfig(config = {}) {
    if (!config) return;
    const { logger } = this.ctx;

    try {
      let src = config;
      if (typeof config === 'string') {
        if (isJSON(config)) {
          src = tryParseJSON(config, null);
        } else {
          return;
        }
      }
      if (!src || typeof src !== 'object') return;

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
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Failed to apply cache config', {
        operation: 'cache-config-apply',
        errorReference,
        message: error.message,
        stack: error.stack,
        incomingConfigType: typeof config,
      });
    }
  }

  async refreshConfigFromRemote(requestConfig) {
    const { config, logger } = this.ctx;
    if (!config?.getCacheConfig) return;

    try {
      const remoteCfg = await config.getCacheConfig(requestConfig);
      this.applyConfig(remoteCfg);
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.warn?.('CacheService: failed to refresh config from remote', {
        operation: 'cache-config-refresh',
        errorReference,
        message: String(error?.message || error),
        correlationId: requestConfig?.correlationId,
      });
    }
  }

  _setCleanupTimer(intervalMs) {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    this._cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
  }

  set(key, value, ttl = this.defaultTTL) {
    const { logger } = this.ctx;

    try {
      if (this.cache.size >= this.maxSize) {
        this.evictOldest();
      }

      const effectiveTtl = Math.max(
        this.defaultTTL,
        Number(ttl) || this.defaultTTL
      );
      const now = Date.now();
      const expiry = now + effectiveTtl;
      // console.log(`[CACHE-DEBUG] set key=${key} now=${now} effectiveTtl=${effectiveTtl} expiry=${expiry}`);

      this.cache.set(key, {
        value,
        timestamp: now,
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
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Cache set failed', {
        operation: 'cache-set',
        errorReference,
        key,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  get(key) {
    const { logger } = this.ctx;
    try {
      const ttlEntry = this.ttlMap.get(key);
      // console.log(`[DEBUG] get key=${key} now=${Date.now()} ttlEntry=${ttlEntry} expired=${Date.now() > ttlEntry}`);

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
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Cache get failed', {
        operation: 'cache-get',
        errorReference,
        key,
        message: error.message,
        stack: error.stack,
      });
      return null;
    }
  }

  delete(key) {
    const { logger } = this.ctx;
    try {
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
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Cache delete failed', {
        operation: 'cache-delete',
        errorReference,
        key,
        message: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  has(key) {
    try {
      const ttlEntry = this.ttlMap.get(key);
      if (!ttlEntry || Date.now() > ttlEntry) {
        this.delete(key);
        return false;
      }
      return this.cache.has(key);
    } catch {
      return false;
    }
  }

  clear() {
    const { logger } = this.ctx;
    try {
      const size = this.cache.size;
      this.cache.clear();
      this.ttlMap.clear();

      logger?.info?.('Cache cleared', {
        operation: 'cache-clear',
        clearedEntries: size,
      });
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Cache clear failed', {
        operation: 'cache-clear',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  cleanupSelective(cutoffTimestamp) {
    const { logger } = this.ctx;
    try {
      const cutoff = new Date(cutoffTimestamp).getTime();
      let clearedCount = 0;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.timestamp < cutoff) {
          this.delete(key);
          clearedCount++;
        }
      }

      logger?.info?.('Selective cache cleanup completed', {
        operation: 'cache-cleanup-selective',
        clearedEntries: clearedCount,
        cutoffTimestamp,
      });
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Selective cache cleanup failed', {
        operation: 'cache-cleanup-selective',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  cleanup() {
    const { logger } = this.ctx;
    try {
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
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Cache cleanup failed', {
        operation: 'cache-cleanup',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  evictOldest() {
    const { logger } = this.ctx;
    try {
      if (this.cache.size === 0) return;

      const oldestKey = this.cache.keys().next().value;

      if (oldestKey) {
        this.delete(oldestKey);
        logger?.debug?.('Cache entry evicted', {
          operation: 'cache-evict',
          key: oldestKey,
          reason: 'size-limit-lru',
        });
      }
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Cache eviction failed', {
        operation: 'cache-evict',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  getStats(includeEntryValue = false) {
    try {
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
    } catch (error) {
      const { logger } = this.ctx;
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      logger?.error?.('Cache stats failed', {
        operation: 'cache-stats-get',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      return {
        size: 0,
        maxSize: this.maxSize,
        entries: [],
        totalSize: 0,
        averageSize: 0,
        errorReference,
      };
    }
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

    if (this.pendingPromises.has(key)) {
      return this.pendingPromises.get(key);
    }

    const promise = asyncFunction()
      .then((result) => {
        this.set(key, result, ttl);
        this.pendingPromises.delete(key);
        return result;
      })
      .catch((error) => {
        this.pendingPromises.delete(key);
        const { logger } = this.ctx;
        const errorReference =
          error.errorReference || createERC(ERC_PREFIX.ERROR);
        logger?.error?.('Cache remember failed', {
          operation: 'cache-remember',
          errorReference,
          key,
          message: error.message,
          stack: error.stack,
        });
        throw Object.assign(error, { errorReference });
      });

    this.pendingPromises.set(key, promise);
    return promise;
  }

  cacheConfig(key, value, ttl = this.defaultTTL) {
    this.set(`config:${key}`, value, ttl);
  }

  getConfig(key) {
    return this.get(`config:${key}`);
  }

  cacheApiResponse(url, method, body, response, ttl = 300000) {
    const cacheKey = `api:${method}:${url}:${this._normalizeRequestBodyForCache(
      body
    )}`;
    this.set(cacheKey, response, ttl);
  }

  getApiResponse(url, method, body) {
    const cacheKey = `api:${method}:${url}:${this._normalizeRequestBodyForCache(
      body
    )}`;
    return this.get(cacheKey);
  }
}

module.exports = CacheService;
