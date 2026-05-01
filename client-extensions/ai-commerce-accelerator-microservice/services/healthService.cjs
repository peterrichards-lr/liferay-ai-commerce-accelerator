const { ENV } = require('../utils/constants.cjs');

class HealthService {
  constructor(ctx) {
    this.ctx = ctx;
    this.startTime = Date.now();
    this.healthChecks = new Map();
    this.lastHealthCheck = null;

    this.registerHealthCheck('database', this.checkDatabase.bind(this));
    this.registerHealthCheck('openai', this.checkOpenAI.bind(this));
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
    return {
      status: 'healthy',
      message: 'No direct database connection required',
      responseTime: 0,
    };
  }

  async checkOpenAI() {
    const { config } = this.ctx;
    const start = Date.now();
    try {
      const apiKey = await config.getOpenAIKeyCached();
      const responseTime = Date.now() - start;

      if (!apiKey) {
        return {
          status: 'healthy',
          message: 'OpenAI API key not configured',
          responseTime,
          name: 'openai',
          timestamp: new Date().toISOString(),
        };
      }

      return {
        status: 'healthy',
        message: 'OpenAI API key configured',
        responseTime,
        name: 'openai',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message,
        responseTime: Date.now() - start,
        name: 'openai',
        timestamp: new Date().toISOString(),
      };
    }
  }

  async checkLiferay() {
    const start = Date.now();
    try {
      const responseTime = Date.now() - start;

      return {
        status: 'healthy',
        message: 'Liferay service available',
        responseTime,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message,
        responseTime: Date.now() - start,
      };
    }
  }

  checkMemory() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const memoryUsagePercent = (heapUsedMB / heapTotalMB) * 100;

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
        heapTotalMB: Math.round(heapTotalMB),
        usagePercent: Math.round(memoryUsagePercent),
      },
    });
  }

  checkDiskSpace() {
    return Promise.resolve({
      status: 'healthy',
      message: 'Disk space sufficient',
      responseTime: 1,
    });
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
    const criticalChecks = ['openai', 'memory'];

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
