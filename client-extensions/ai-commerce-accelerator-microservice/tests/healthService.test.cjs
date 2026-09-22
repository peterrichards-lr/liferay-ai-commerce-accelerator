const fs = require('fs/promises');

const HealthService = require('../services/healthService.cjs');
const { ENV } = require('../utils/constants.cjs');

describe('HealthService', () => {
  let healthService;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      config: {
        getAIKey: vi.fn().mockResolvedValue('test-api-key'),
        getAIMediaKey: vi.fn().mockResolvedValue('test-media-key'),
        getAIConfig: vi.fn().mockResolvedValue({
          provider: 'openai',
          mediaProvider: 'inherit',
        }),
        getOAuthConfig: vi.fn().mockResolvedValue({
          liferayUrl: 'http://localhost:8080',
          clientId: 'mock-id',
          clientSecret: 'mock-secret',
        }),
      },
      persistence: {
        ping: vi.fn().mockReturnValue(true),
      },
      liferay: {
        rest: {
          testConnection: vi.fn().mockResolvedValue(true),
        },
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };
    healthService = new HealthService(mockCtx);
  });

  it('should register default health checks', () => {
    expect(healthService.healthChecks.has('database')).toBe(true);
    expect(healthService.healthChecks.has('ai')).toBe(true);
    expect(healthService.healthChecks.has('liferay')).toBe(true);
    expect(healthService.healthChecks.has('memory')).toBe(true);
    expect(healthService.healthChecks.has('disk')).toBe(true);
  });

  it('should return system info', async () => {
    const info = await healthService.getSystemInfo();
    expect(info.service).toBe('liferay-ai-data-microservice');
    expect(info.version).toBe('1.0.0');
    expect(info.uptime).toBeDefined();
    expect(info.memory).toBeDefined();
  });

  it('should run all health checks and return a healthy status', async () => {
    // Memory and disk read the real process heap and the real root
    // filesystem, so the aggregate depended on whatever the machine happened
    // to be doing. Under vitest's own heap this asserted 'healthy' and got
    // 'degraded', failing locally while passing in CI - not because CI is
    // right, but because its runners happened to sit under the thresholds.
    //
    // Pinned to known-good values so the case tests the roll-up, which is what
    // it is for, rather than the host it runs on. The unhealthy paths are
    // covered separately, and `process.memoryUsage` is stubbed there the same
    // way.
    const originalMemoryUsage = process.memoryUsage;

    process.memoryUsage = vi.fn().mockReturnValue({
      heapUsed: 64 * 1024 * 1024, // 12.5% of the 512MB ceiling
      heapTotal: 128 * 1024 * 1024,
      external: 0,
      rss: 128 * 1024 * 1024,
    });

    const statfs = vi.spyOn(fs, 'statfs').mockResolvedValue({
      blocks: 1000,
      bsize: 4096,
      bfree: 500, // 50% free
    });

    let report;

    try {
      report = await healthService.runAllHealthChecks();
    } finally {
      process.memoryUsage = originalMemoryUsage;
      statfs.mockRestore();
    }

    expect(report.status).toBe('healthy');
    expect(report.checks.database.status).toBe('healthy');
    expect(report.checks.ai.status).toBe('healthy');
    // The two that made this environmental, asserted explicitly so a future
    // change to either threshold fails here rather than intermittently.
    expect(report.checks.memory.status).toBe('healthy');
    expect(report.checks.disk.status).toBe('healthy');
  });

  // The credentials half of this fallback read LIFERAY_CLIENT_ID and
  // LIFERAY_CLIENT_SECRET, which nothing in this project defines - AICA's are
  // LIFERAY_OAUTH_CLIENT_ID and LIFERAY_OAUTH_CLIENT_SECRET - so the check
  // connected with a URL and no credentials, which is the one case the
  // fallback exists for. The test that should have caught it set the names the
  // code read, so it pinned the typo and would have stayed green had they been
  // BANANA_CLIENT_ID (#933).
  //
  // This drives the configuration the service itself resolves, so it asserts
  // that whatever the deployment supplied reaches the connection, and says
  // nothing about which variable carried it there.
  it('connects with the credentials the service resolved, when getOAuthConfig returns nothing', async () => {
    mockCtx.config.getOAuthConfig.mockResolvedValue({});
    const resolved = {
      LIFERAY_OAUTH_CLIENT_ID: 'resolved-client-id',
      LIFERAY_OAUTH_CLIENT_SECRET: 'resolved-client-secret',
      LIFERAY_URL: 'https://aica-e2e.demo',
    };
    const original = Object.fromEntries(
      Object.keys(resolved).map((key) => [key, ENV[key]])
    );
    Object.assign(ENV, resolved);

    try {
      const result = await healthService.runHealthCheck('liferay');

      expect(result.status).toBe('healthy');
      expect(mockCtx.liferay.rest.testConnection).toHaveBeenCalledWith({
        clientId: resolved.LIFERAY_OAUTH_CLIENT_ID,
        clientSecret: resolved.LIFERAY_OAUTH_CLIENT_SECRET,
        liferayUrl: resolved.LIFERAY_URL,
      });
    } finally {
      Object.assign(ENV, original);
    }
  });

  it('prefers a persisted OAuth config over the resolved environment', async () => {
    const original = {
      LIFERAY_OAUTH_CLIENT_ID: ENV.LIFERAY_OAUTH_CLIENT_ID,
      LIFERAY_OAUTH_CLIENT_SECRET: ENV.LIFERAY_OAUTH_CLIENT_SECRET,
    };
    Object.assign(ENV, {
      LIFERAY_OAUTH_CLIENT_ID: 'resolved-client-id',
      LIFERAY_OAUTH_CLIENT_SECRET: 'resolved-client-secret',
    });

    try {
      await healthService.runHealthCheck('liferay');

      expect(mockCtx.liferay.rest.testConnection).toHaveBeenCalledWith({
        clientId: 'mock-id',
        clientSecret: 'mock-secret',
        liferayUrl: 'http://localhost:8080',
      });
    } finally {
      Object.assign(ENV, original);
    }
  });

  it('should return unhealthy if memory check fails', async () => {
    // Force unhealthy memory status by mocking process.memoryUsage
    const originalMemoryUsage = process.memoryUsage;
    process.memoryUsage = vi.fn().mockReturnValue({
      heapUsed: 500 * 1024 * 1024, // 500MB, which is > 90% of the 512MB limit
      heapTotal: 512 * 1024 * 1024,
      external: 0,
      rss: 600 * 1024 * 1024,
    });

    const result = await healthService.runHealthCheck('memory');
    expect(result.status).toBe('unhealthy');

    process.memoryUsage = originalMemoryUsage;
  });
});
