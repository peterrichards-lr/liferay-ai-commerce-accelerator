import { vi, describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ENV } = require('../src/utils/constants.cjs');

// Set global process env for the SDK to pick up
process.env.LIFERAY_RETRY_DELAY_MS = '1';

// Mock config-node
vi.doMock('@rotty3000/config-node', () => ({
  lxcConfig: {
    oauthApplication: vi.fn().mockReturnValue({}),
    userAgentApplication: vi.fn().mockReturnValue({}),
    dxpMainDomain: vi.fn().mockReturnValue('localhost'),
    dxpProtocol: vi.fn().mockReturnValue('http'),
  },
  lookupConfig: vi.fn().mockReturnValue(null),
}));

const LiferayRestService = (await import('../src/liferay/rest.cjs')).default;

describe('SDK Resilience & Retry', () => {
  let restService;
  let mockCtx;
  const config = {
    liferayUrl: 'http://localhost:8080',
    clientId: 'test-id',
    clientSecret: 'test-secret',
  };

  beforeEach(() => {
    const mockCache = new Map();
    mockCtx = {
      cache: {
        get: vi.fn((key) => mockCache.get(key)),
        set: vi.fn((key, value) => mockCache.set(key, value)),
        delete: vi.fn((key) => mockCache.delete(key)),
        clear: vi.fn(() => mockCache.clear()),
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        trace: vi.fn(),
      },
      oauth: {
        getAccessToken: vi.fn().mockResolvedValue('test-token'),
      },
    };

    restService = new LiferayRestService(mockCtx);
  });

  it('should retry on transient failures and eventually succeed', async () => {
    let attempts = 0;

    server.use(
      http.get('http://localhost:8080/o/test-retry-success', () => {
        attempts++;
        if (attempts < 3) {
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json({ success: true });
      })
    );

    const result = await restService._request(config, {
      method: 'GET',
      url: '/o/test-retry-success',
      op: 'test-op',
    });

    expect(attempts).toBe(3);
    expect(result.success).toBe(true);
  });

  it('should fail after maximum retries', async () => {
    let attempts = 0;

    server.use(
      http.get('http://localhost:8080/o/test-retry-fail', () => {
        attempts++;
        return new HttpResponse(null, { status: 500 });
      })
    );

    await expect(
      restService._request(config, {
        method: 'GET',
        url: '/o/test-retry-fail',
        op: 'test-op',
      })
    ).rejects.toThrow();

    expect(attempts).toBe(3);
  });

  it('should respect LIFERAY_API_MAX_RETRIES environment variable', async () => {
    let attempts = 0;
    const oldVal = ENV.LIFERAY_API_MAX_RETRIES;
    ENV.LIFERAY_API_MAX_RETRIES = 4;

    try {
      server.use(
        http.get('http://localhost:8080/o/test-retry-custom', () => {
          attempts++;
          return new HttpResponse(null, { status: 500 });
        })
      );

      await expect(
        restService._request(config, {
          method: 'GET',
          url: '/o/test-retry-custom',
          op: 'test-op',
        })
      ).rejects.toThrow();

      expect(attempts).toBe(4);
    } finally {
      ENV.LIFERAY_API_MAX_RETRIES = oldVal;
    }
  });

  it('should abort deleteByIds and throw when transient errors meet the threshold', async () => {
    let attempts = 0;
    server.use(
      http.delete('http://localhost:8080/o/delete-items/*', () => {
        attempts++;
        return new HttpResponse(null, { status: 500 });
      })
    );

    const oldThreshold = ENV.LIFERAY_MAX_DELETION_ERRORS;
    const oldRetries = ENV.LIFERAY_API_MAX_RETRIES;
    ENV.LIFERAY_MAX_DELETION_ERRORS = 2;
    ENV.LIFERAY_API_MAX_RETRIES = 1;

    try {
      await expect(
        restService._deleteByIds(config, {
          baseDeletePath: '/o/delete-items',
          ids: ['1', '2', '3', '4', '5'],
          concurrency: 1,
          op: 'test-delete-op',
          friendly: 'test delete',
        })
      ).rejects.toThrow(/Deletion failed: encountered 2 errors/);

      expect(attempts).toBe(2);
    } finally {
      ENV.LIFERAY_MAX_DELETION_ERRORS = oldThreshold;
      ENV.LIFERAY_API_MAX_RETRIES = oldRetries;
    }
  });
});
