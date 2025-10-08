const {cacheService} = require('../services/cacheService.cjs');

module.exports = function (app, logger) {
  app.get('/api/cache/stats', async (req, res) => {
    try {
      const stats = cacheService.getStats();
      res.json({ success: true, stats });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'cache-stats',
      });
      res.status(500).json({ error: 'Failed to get cache stats' });
    }
  });
  app.get('/api/cache/entries', async (req, res) => {
    try {
      const stats = cacheService.getStats(true);
      res.json({ success: true, stats });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'cache-entries',
      });
      res.status(500).json({ error: 'Failed to get cache entries' });
    }
  });
};
