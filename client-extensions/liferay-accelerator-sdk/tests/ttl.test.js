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

    it('should use runtime config or default fallback if config is absent', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({});
      expect(ttl.getSessionTTLms(mockConfig, { sessionTtlMinutes: 45 })).toBe(
        ttl.MIN(45)
      );
      expect(ttl.getSessionTTLms(mockConfig, {})).toBe(ttl.MIN(30));
    });
  });

  describe('getEphemeralTTLms', () => {
    it('should use config value if present and clamp it', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({
        ephemeralTTL: ttl.MIN(15),
      });
      expect(ttl.getEphemeralTTLms(mockConfig)).toBe(ttl.MIN(15));

      mockConfig.getCacheConfigCached.mockReturnValue({
        ephemeralTTL: ttl.SEC(30), // Too low (min 1 min)
      });
      expect(ttl.getEphemeralTTLms(mockConfig)).toBe(ttl.MIN(1));
    });

    it('should use runtime config or default fallback if config is absent', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({});
      expect(
        ttl.getEphemeralTTLms(mockConfig, { ephemeralTtlMinutes: 12 })
      ).toBe(ttl.MIN(12));
      expect(ttl.getEphemeralTTLms(mockConfig, {})).toBe(ttl.MIN(5));
    });
  });

  describe('getUploadTTLms', () => {
    it('should use config value if present and clamp it', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({
        uploadTTL: ttl.MIN(40),
      });
      expect(ttl.getUploadTTLms(mockConfig)).toBe(ttl.MIN(40));

      mockConfig.getCacheConfigCached.mockReturnValue({
        uploadTTL: ttl.MIN(120), // Too high (max 60 min)
      });
      expect(ttl.getUploadTTLms(mockConfig)).toBe(ttl.MIN(60));
    });

    it('should use runtime config or default fallback if config is absent', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({});
      expect(ttl.getUploadTTLms(mockConfig, { uploadTtlMinutes: 25 })).toBe(
        ttl.MIN(25)
      );
      expect(ttl.getUploadTTLms(mockConfig, {})).toBe(ttl.MIN(15));
    });
  });

  describe('getLongLivedTTLms', () => {
    it('should use config value if present and clamp it', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({
        ercConfigTTL: ttl.MIN(100),
      });
      expect(ttl.getLongLivedTTLms(mockConfig)).toBe(ttl.MIN(100));

      mockConfig.getCacheConfigCached.mockReturnValue({
        ercConfigTTL: ttl.MIN(200), // Too high (max 180 min)
      });
      expect(ttl.getLongLivedTTLms(mockConfig)).toBe(ttl.MIN(180));
    });

    it('should use runtime config or default fallback if config is absent', () => {
      mockConfig.getCacheConfigCached.mockReturnValue({});
      expect(
        ttl.getLongLivedTTLms(mockConfig, { ercConfigTtlMinutes: 90 })
      ).toBe(ttl.MIN(90));
      expect(ttl.getLongLivedTTLms(mockConfig, {})).toBe(ttl.MIN(60));
    });
  });
});
