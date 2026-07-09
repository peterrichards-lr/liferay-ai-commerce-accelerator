const fs = require('fs/promises');
const { ENV } = require('../utils/constants.cjs');

class HealthService {
  constructor(ctx) {
    this.ctx = ctx;
    this.startTime = Date.now();
    this.healthChecks = new Map();
    this.lastHealthCheck = null;
    this._liferayCachedResult = null;
    this._liferayCachedAt = 0;
    this._liferayCacheTtlMs = 20000; // 20 seconds

    this.registerHealthCheck('database', this.checkDatabase.bind(this));
    this.registerHealthCheck('ai', this.checkAI.bind(this));
    this.registerHealthCheck('liferay', this.checkLiferay.bind(this));
    this.registerHealthCheck('memory', this.checkMemory.bind(this));
    this.registerHealthCheck('disk', this.checkDiskSpace.bind(this));
  }

  registerHealthCheck(name, checkFunction) {
    this.healthChecks.set(name, checkFunction);
  }

  async getSystemInfo() {
    const memUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;

    return {
      service: 'liferay-ai-data-microservice',
      version: '1.0.0',
      environment: ENV.NODE_ENV,
      uptime: Math.floor(uptime / 1000),
      timestamp: new Date().toISOString(),
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      },
    };
  }

  async checkDatabase() {
    const { persistence } = this.ctx;
    const start = Date.now();

    try {
      const isAlive = persistence?.ping?.();
      const responseTime = Date.now() - start;

      if (isAlive) {
        return {
          status: 'healthy',
          message: 'SQLite database is available and responding',
          responseTime,
        };
      }

      return {
        status: 'unhealthy',
        message: 'SQLite database is not responding',
        responseTime,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Database health check failed: ${error.message}`,
        responseTime: Date.now() - start,
      };
    }
  }

  async checkAI() {
    const { config } = this.ctx;
    const start = Date.now();
    try {
      const requestConfig = {};
      let aiConfig = {};
      try {
        aiConfig = (await config.getAIConfig(requestConfig)) || {};
      } catch (e) {
        this.ctx.logger.debug('Failed to fetch AI Config for health check', {
          error: e.message,
        });
      }

      const textProvider = (aiConfig?.provider || 'OPENAI').toUpperCase();
      const mediaProvider = (
        aiConfig?.mediaProvider || 'INHERIT'
      ).toUpperCase();

      let textKey = null;
      try {
        textKey = await config.getAIKey(requestConfig);
      } catch (_e) {
        // Ignore key retrieval errors for status check
      }

      let mediaKey = null;
      try {
        mediaKey = await config.getAIMediaKey(requestConfig);
      } catch (_e) {
        // Ignore key retrieval errors for status check
      }

      if (mediaProvider === 'INHERIT') {
        mediaKey = textKey;
      }

      const responseTime = Date.now() - start;

      const textStatus = textKey ? 'CONFIGURED' : 'MISSING';
      const mediaStatus = mediaKey ? 'CONFIGURED' : 'MISSING';

      const isHealthy = !!(textKey && mediaKey);

      return {
        status: 'healthy',
        message: isHealthy
          ? 'AI services configured'
          : 'AI credentials missing',
        responseTime,
        details: {
          text: {
            provider: textProvider,
            status: textStatus,
          },
          media: {
            provider: mediaProvider,
            status: mediaStatus,
          },
        },
        name: 'ai',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message,
        responseTime: Date.now() - start,
        name: 'ai',
        timestamp: new Date().toISOString(),
      };
    }
  }

  async checkLiferay() {
    const now = Date.now();
    if (
      this._liferayCachedResult &&
      now - this._liferayCachedAt < this._liferayCacheTtlMs
    ) {
      return this._liferayCachedResult;
    }

    const { liferay, config: configService } = this.ctx;
    const start = Date.now();
    try {
      const requestConfig = {};
      let oauthConfig = {};
      try {
        oauthConfig = await configService.getOAuthConfig(requestConfig);
      } catch (_err) {
        oauthConfig = {
          liferayUrl: process.env.LIFERAY_URL || 'http://localhost:8080',
          clientId: process.env.LIFERAY_CLIENT_ID,
          clientSecret: process.env.LIFERAY_CLIENT_SECRET,
        };
      }

      await liferay.rest.testConnection(oauthConfig);
      const responseTime = Date.now() - start;

      const result = {
        status: 'healthy',
        message: 'Liferay service available',
        responseTime,
      };
      this._liferayCachedResult = result;
      this._liferayCachedAt = Date.now();
      return result;
    } catch (error) {
      const result = {
        status: 'unhealthy',
        message: `Liferay service check failed: ${error.message}`,
        responseTime: Date.now() - start,
      };
      // Don't cache unhealthy results — allow immediate retry on next probe
      return result;
    }
  }

  checkMemory() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    // V8 dynamically resizes heapTotal. Comparing heapUsed to heapTotal often yields >90% before a GC sweep.
    // Instead, we evaluate against an arbitrary reasonable max (e.g. 512MB) to prevent false health failures.
    const maxMemoryMB = 512;
    const memoryUsagePercent = (heapUsedMB / maxMemoryMB) * 100;

    const status =
      memoryUsagePercent > 90
        ? 'unhealthy'
        : memoryUsagePercent > 80
          ? 'degraded'
          : 'healthy';

    return Promise.resolve({
      status,
      message: `Memory usage: ${memoryUsagePercent.toFixed(2)}%`,
      responseTime: 1,
      details: {
        heapUsedMB: Math.round(heapUsedMB),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        usagePercent: Math.round(memoryUsagePercent),
      },
    });
  }

  async checkDiskSpace() {
    const start = Date.now();
    try {
      const rootPath = process.platform === 'win32' ? 'C:\\' : '/';
      const stats = await fs.statfs(rootPath);

      const totalBytes = stats.blocks * stats.bsize;
      const freeBytes = stats.bfree * stats.bsize;
      const freePercent = (freeBytes / totalBytes) * 100;

      const status =
        freePercent < 10
          ? 'unhealthy'
          : freePercent < 15
            ? 'degraded'
            : 'healthy';

      return {
        status,
        message: `Disk space: ${freePercent.toFixed(2)}% free (${Math.round(
          freeBytes / 1024 / 1024 / 1024
        )}GB of ${Math.round(totalBytes / 1024 / 1024 / 1024)}GB)`,
        responseTime: Date.now() - start,
        details: {
          freeBytes,
          totalBytes,
          freePercent: Math.round(freePercent),
        },
      };
    } catch (error) {
      return {
        status: 'degraded',
        message: `Disk space check failed: ${error.message}`,
        responseTime: Date.now() - start,
      };
    }
  }

  async runHealthCheck(name) {
    const { logger } = this.ctx;
    const start = Date.now();

    try {
      const checkFunction = this.healthChecks.get(name);
      if (!checkFunction) {
        throw new Error(`Health check '${name}' not found`);
      }

      const result = await checkFunction();
      const totalTime = Date.now() - start;

      logger.debug(`Health check completed: ${name}`, {
        operation: 'health-check',
        healthCheck: name,
        status: result.status,
        responseTime: result.responseTime || totalTime,
      });

      return {
        ...result,
        name,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const totalTime = Date.now() - start;

      logger.error(`Health check failed: ${name}`, {
        operation: 'health-check',
        healthCheck: name,
        error: error.message,
        responseTime: totalTime,
      });

      return {
        name,
        status: 'unhealthy',
        message: error.message,
        responseTime: totalTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async runAllHealthChecks() {
    const { logger } = this.ctx;
    const start = Date.now();
    const checks = {};

    const promises = Array.from(this.healthChecks.keys()).map(async (name) => {
      const result = await this.runHealthCheck(name);
      checks[name] = result;
    });

    await Promise.all(promises);

    const allStatuses = Object.values(checks).map((check) => check.status);
    const overallStatus = allStatuses.includes('unhealthy')
      ? 'unhealthy'
      : allStatuses.includes('degraded')
        ? 'degraded'
        : 'healthy';

    const healthReport = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      totalResponseTime: Date.now() - start,
      checks,
    };

    this.lastHealthCheck = healthReport;

    logger.info(`Health check completed`, {
      operation: 'health-check-all',
      overallStatus,
      totalResponseTime: healthReport.totalResponseTime,
      checksCount: Object.keys(checks).length,
    });

    return healthReport;
  }

  async getDetailedHealth() {
    const systemInfo = await this.getSystemInfo();
    const healthChecks = await this.runAllHealthChecks();

    return {
      ...systemInfo,
      health: healthChecks,
    };
  }

  async getReadinessProbe() {
    const criticalChecks = ['ai', 'memory'];

    for (const checkName of criticalChecks) {
      const result = await this.runHealthCheck(checkName);
      if (result.status === 'unhealthy') {
        return {
          ready: false,
          reason: `Critical health check failed: ${checkName}`,
          timestamp: new Date().toISOString(),
        };
      }
    }

    return {
      ready: true,
      timestamp: new Date().toISOString(),
    };
  }

  async getLivenessProbe() {
    const memCheck = await this.runHealthCheck('memory');

    return {
      alive: memCheck.status !== 'unhealthy',
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = HealthService;
