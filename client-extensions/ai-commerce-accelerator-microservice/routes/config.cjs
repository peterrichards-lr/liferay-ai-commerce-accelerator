module.exports = function (app, logger) {
  app.get('/api/config/polling', async (req, res) => {
    try {
      const liferayConfig = (await liferayService.getConfig(
        config,
        'batch-polling-config'
      )) || {
        pollInterval: 5000,
        minPollInterval: 2000,
        maxPollAttempts: 120,
        maxRetries: 3,
      };

      res.json({
        success: true,
        config: liferayConfig,
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'get-polling-config',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get polling configuration',
      });
    }
  });

  // Update polling configuration endpoint
  app.post('/api/config/polling', async (req, res) => {
    try {
      const { pollInterval, maxPollAttempts } = req.body;

      // Validate configuration
      const validatedConfig = {
        pollInterval: Math.max(pollInterval || 5000, 2000), // Minimum 2 seconds
        maxPollAttempts: Math.min(Math.max(maxPollAttempts || 120, 10), 600), // Min 10, Max 600 (50 minutes)
      };
      logger.info('Polling configuration updated', {
        operation: 'update-polling-config',
        correlationId: req.correlationId,
        config: validatedConfig,
      });

      res.json({
        success: true,
        config: validatedConfig,
        message: 'Polling configuration updated successfully',
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'update-polling-config',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update polling configuration',
      });
    }
  });

  app.get('/api/openai-status', async (req, res) => {
    try {
      const { ConfigService } = require('./services/configService.cjs');
      const configServiceInstance = new ConfigService();

      const keyAvailable = false;

      logger.info('OpenAI status check', {
        correlationId: req.correlationId,
        operation: 'openai-status-check',
        keyAvailable,
      });

      res.json({
        success: true,
        keyAvailable,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'openai-status-check',
      });

      res.status(500).json({
        success: false,
        keyAvailable: false,
        error: 'Failed to check OpenAI status',
        timestamp: new Date().toISOString(),
      });
    }
  });
};
