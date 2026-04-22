const { LiferayService } = require('../services/liferay/index.cjs');
const OAuthService = require('../services/liferay/oauth.cjs');
const { http, HttpResponse } = require('msw');
const { server } = require('./mocks/server.cjs');

describe.skip('Resilience & Retry', () => {
  let liferayService;
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
        get: (key) => mockCache.get(key),
        set: (key, value) => mockCache.set(key, value),
        clear: () => mockCache.clear(),
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        trace: vi.fn(),
      },
      config: {
        getExcludeLists: vi.fn().mockResolvedValue([]),
        getLiferaySyncDelayMs: vi.fn().mockReturnValue(0),
      },
    };
    mockCtx.oauth = new OAuthService(mockCtx);
    liferayService = new LiferayService(mockCtx);
  });

  it('should retry on transient failures and eventually succeed', async () => {
    let attempts = 0;

    // Override handler for this specific test
    server.use(
      http.get('*/o/headless-commerce-admin-catalog/v1.0/products', () => {
        attempts++;
        // console.log(`[RESILIENCE-MOCK] attempt ${attempts}`);
        if (attempts < 3) {
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json({ items: [{ id: 1 }], totalCount: 1 });
      })
    );

    const result = await liferayService.getProducts(config, { catalogId: 123 });

    expect(attempts).toBe(3);
    expect(result.totalCount).toBe(1);
  });

  it('should fail after maximum retries', async () => {
    let attempts = 0;

    server.use(
      http.get('*/o/headless-commerce-admin-catalog/v1.0/products', () => {
        attempts++;
        return new HttpResponse(null, { status: 500 });
      })
    );

    // We expect it to throw after RETRY.maxAttempts (default 3)
    await expect(
      liferayService.getProducts(config, { catalogId: 123 })
    ).rejects.toThrow();

    // It should have attempted exactly 3 times (1 initial + 2 retries)
    // Actually, looking at liferayService, it uses processWithRetry which by default does 3 attempts.
    expect(attempts).toBe(3);
  });
});
