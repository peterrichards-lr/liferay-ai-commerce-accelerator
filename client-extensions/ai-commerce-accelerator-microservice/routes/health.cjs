module.exports = (app, { logger, healthService }) => {
  app.get('/api/health', async (req, res) => {
    try {
      const health = await healthService.runAllHealthChecks();
      const statusCode = health.status === 'healthy'
        ? 200
        : health.status === 'degraded'
          ? 200
          : 503;

      res.status(statusCode).json(health);
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'health-check',
      });
      res.status(503).json({
        status: 'unhealthy',
        message: 'Health check failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/health/detailed', async (req, res) => {
    try {
      const detailedHealth = await healthService.getDetailedHealth();
      res.json(detailedHealth);
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'detailed-health-check',
      });
      res.status(503).json({ error: 'Health check failed' });
    }
  });

  app.get('/api/health/ready', async (req, res) => {
    try {
      const readiness = await healthService.getReadinessProbe();
      res.status(readiness.ready ? 200 : 503).json(readiness);
    } catch (error) {
      res.status(503).json({ ready: false, error: error.message });
    }
  });

  app.get('/api/health/live', async (req, res) => {
    try {
      const liveness = await healthService.getLivenessProbe();
      res.status(liveness.alive ? 200 : 503).json(liveness);
    } catch (error) {
      res.status(503).json({ alive: false, error: error.message });
    }
  });
};
