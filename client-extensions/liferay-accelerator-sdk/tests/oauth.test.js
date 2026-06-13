import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutate config-node module directly to bypass ESM/CommonJS mock hoisting limitations
const configNode = require('@rotty3000/config-node');

configNode.lxcConfig.oauthApplication = vi.fn().mockReturnValue({
  tokenUri: () => '/o/oauth2/token',
  clientId: () => 'mock-client-id',
  clientSecret: () => 'mock-client-secret',
});
configNode.lxcConfig.dxpMainDomain = vi.fn().mockReturnValue('localhost');
configNode.lxcConfig.dxpProtocol = vi.fn().mockReturnValue('http');

const OAuthService = require('../src/liferay/oauth.cjs');

describe('OAuthService', () => {
  let mockContext;
  let mockCache;
  let mockLogger;
  let mockConfigService;

  beforeEach(() => {
    mockCache = new Map();
    mockLogger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    };
    mockConfigService = {
      getOAuthConfigCached: vi.fn().mockReturnValue(null),
      getOAuthConfig: vi.fn().mockResolvedValue({}),
    };

    mockContext = {
      cache: mockCache,
      logger: mockLogger,
      config: mockConfigService,
    };
  });

  describe('Initialization and Config', () => {
    it('should initialize with default settings', () => {
      const service = new OAuthService(mockContext);
      expect(service.settings.maxRetries).toBe(2);
      expect(service.settings.tokenSkewSec).toBe(60);
    });

    it('should apply custom configuration settings via applyConfig', () => {
      const service = new OAuthService(mockContext);
      service.applyConfig({
        maxRetries: 5,
        tokenSkewSec: 30,
        tokenCacheTtlMs: 120000,
      });
      expect(service.settings.maxRetries).toBe(5);
      expect(service.settings.tokenSkewSec).toBe(60); // Math.max with default 60
      expect(service.settings.tokenCacheTtlMs).toBe(3600000); // Math.max with default 3600000
    });

    it('should refresh configurations from remote config service', async () => {
      const service = new OAuthService(mockContext);
      mockConfigService.getOAuthConfig.mockResolvedValue({
        maxRetries: 4,
      });
      await service.refreshConfigFromRemote();
      expect(service.settings.maxRetries).toBe(4);
    });
  });

  describe('Cache Management', () => {
    it('should generate cache key based on URL and Client ID', () => {
      const service = new OAuthService(mockContext);
      const key = service._generateCacheKey('http://liferay', 'client-id');
      expect(key).toBe('http://liferay_client-id');
    });

    it('should store and retrieve access token from cache', () => {
      const service = new OAuthService(mockContext);
      const key = 'test_key';
      service._addAccessTokenToCache(key, 'token-value', 3600);

      const cachedValue = service._getAccessTokenFromCache(key);
      expect(cachedValue).toBe('token-value');
    });

    it('should return null if cached token has expired', () => {
      const service = new OAuthService(mockContext);
      const key = 'test_key_expired';
      mockCache.set(key, {
        token: 'token-value',
        expiresAt: Date.now() - 1000,
      });

      const cachedValue = service._getAccessTokenFromCache(key);
      expect(cachedValue).toBeNull();
    });

    it('should clear token cache', () => {
      const service = new OAuthService(mockContext);
      const key = 'test_key';
      service._addAccessTokenToCache(key, 'token-value', 3600);

      service.clearTokenCache();
      expect(service._getAccessTokenFromCache(key)).toBeNull();
    });
  });

  describe('Authorize URL Generation', () => {
    it('should correctly generate auth URLs without state', () => {
      const service = new OAuthService(mockContext);
      const url = service.generateAuthUrl(
        'http://liferay',
        'my-client',
        'http://redirect'
      );
      expect(url).toContain('http://liferay/o/oauth2/authorize');
      expect(url).toContain('client_id=my-client');
      expect(url).toContain('redirect_uri=http%3A%2F%2Fredirect');
      expect(url).not.toContain('state=');
    });

    it('should correctly generate auth URLs with state', () => {
      const service = new OAuthService(mockContext);
      const url = service.generateAuthUrl(
        'http://liferay',
        'my-client',
        'http://redirect',
        'my-state'
      );
      expect(url).toContain('state=my-state');
    });
  });

  describe('OAuth Handshake Client Calls', () => {
    it('should validate complete config parameters', () => {
      const service = new OAuthService(mockContext);
      expect(() =>
        service.validateOAuthConfig({
          liferayUrl: 'http://liferay',
          clientId: 'client',
          clientSecret: 'secret',
        })
      ).not.toThrow();
    });

    it('should throw validation error on missing config parameters', () => {
      const service = new OAuthService(mockContext);
      expect(() =>
        service.validateOAuthConfig({
          liferayUrl: 'http://liferay',
          clientId: 'client',
        })
      ).toThrow('Missing OAuth configuration: clientSecret');
    });

    it('should get default client credentials properties', () => {
      const service = new OAuthService(mockContext);
      expect(service.getDefaultLiferayUrl()).toBeDefined();
    });

    it('should throw 400 when missing credentials parameters during retrieval', async () => {
      const service = new OAuthService(mockContext);
      await expect(
        service.getAccessTokenWithCredentials(null, null, null)
      ).rejects.toThrow('OAuth configuration missing');
    });
  });

  describe('Exception Handling', () => {
    it('should handle network connection exceptions correctly', () => {
      const service = new OAuthService(mockContext);
      const networkError = new Error('getaddrinfo ENOTFOUND');
      networkError.code = 'ENOTFOUND';

      expect(() => service._handleException(networkError)).toThrow(
        'Network connection failed: ENOTFOUND'
      );
    });

    it('should handle OAuth authentication exceptions correctly (401/403)', () => {
      const service = new OAuthService(mockContext);
      const authError = new Error('Request failed with status code 401');
      authError.response = { status: 401, statusText: 'Unauthorized' };

      expect(() => service._handleException(authError)).toThrow(
        'OAuth authentication failed'
      );
    });

    it('should handle generic OAuth failure exceptions correctly', () => {
      const service = new OAuthService(mockContext);
      const genericError = new Error('Some general DXP error');
      genericError.response = { status: 502, statusText: 'Bad Gateway' };

      expect(() => service._handleException(genericError)).toThrow(
        'OAuth request failed: Some general DXP error'
      );
    });
  });
});
