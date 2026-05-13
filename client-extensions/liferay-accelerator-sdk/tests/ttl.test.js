import { describe, it, expect, vi } from 'vitest';
const ttl = require('../src/utils/ttl.cjs');

describe('utils/ttl', () => {
  const mockConfig = {
    getBatchPollingConfigCached: vi.fn(),
    getCacheConfigCached: vi.fn(),
  };

  describe('getBatchCacheTTLms', () => {
    it('should calculate TTL based on polling window if no override', () => {
      mockConfig.getBatchPollingConfigCached.mockReturnValue({
        pollInterval: 1000,
        maxPollAttempts: 10,
      });
      mockConfig.getCacheConfigCached.mockReturnValue({});

      const result = ttl.getBatchCacheTTLms(mockConfig);
      // Window = 1000 * 10 = 10s. Default raw = 10s * 3 = 30s.
      // Final TTL = max(30min, 30s) = 30min (1,800,000 ms)
      expect(result).toBe(ttl.MIN(30));
    });

    it('should use override from config if provided', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({
        defaultBatchTTL: ttl.HOUR(1),
      });
      const result = ttl.getBatchCacheTTLms(mockConfig);
      expect(result).toBe(ttl.HOUR(1));
    });
  });

  describe('getSessionTTLms', () => {
    it('should use config value if present', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({
        sessionTTL: ttl.MIN(20),
      });
      expect(ttl.getSessionTTLms(mockConfig)).toBe(ttl.MIN(20));
    });

    it('should clamp values within safe bounds', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({
        sessionTTL: ttl.MIN(1), // Too low
      });
      expect(ttl.getSessionTTLms(mockConfig)).toBe(ttl.MIN(10));

      mockConfig.getCacheConfigCached.mockReturnValue({
        sessionTTL: ttl.HOUR(10), // Too high
      });
      expect(ttl.getSessionTTLms(mockConfig)).toBe(ttl.MIN(240));
    });
  });
});
