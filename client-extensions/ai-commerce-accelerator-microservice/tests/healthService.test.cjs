const HealthService = require('../services/healthService.cjs');

describe('HealthService', () => {
  let healthService;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      config: {
        getAIKeyCached: vi.fn().mockResolvedValue('test-api-key'),
      },
      persistence: {
        ping: vi.fn().mockReturnValue(true),
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
    const report = await healthService.runAllHealthChecks();
    expect(report.status).toBe('healthy');
    expect(report.checks.database.status).toBe('healthy');
    expect(report.checks.ai.status).toBe('healthy');
  });

  it('should return unhealthy if memory check fails', async () => {
    // Force unhealthy memory status by mocking process.memoryUsage
    const originalMemoryUsage = process.memoryUsage;
    process.memoryUsage = vi.fn().mockReturnValue({
      heapUsed: 95,
      heapTotal: 100,
      external: 0,
      rss: 150,
    });

    const result = await healthService.runHealthCheck('memory');
    expect(result.status).toBe('unhealthy');

    process.memoryUsage = originalMemoryUsage;
  });
});
