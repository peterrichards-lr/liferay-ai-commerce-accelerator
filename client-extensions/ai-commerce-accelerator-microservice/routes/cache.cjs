module.exports = function (app, cacheService, logger) {
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
};
