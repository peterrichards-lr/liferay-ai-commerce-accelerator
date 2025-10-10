const { queueService } = require('../services/queueService.cjs');

module.exports = (app, { logger }) => {
  app.get('/api/queue/stats', async (req, res) => {
    try {
      const stats = await queueService.getAllStats();
      res.json({ success: true, stats });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'queue-stats',
      });
      res.status(500).json({ error: 'Failed to get queue stats' });
    }
  });

  app.get('/api/jobs/:jobId', async (req, res) => {
    try {
      const job = await queueService.getJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found',
        });
      }
      res.json({ success: true, job });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'get-job',
        jobId: req.params.jobId,
      });
      res.status(500).json({ error: 'Failed to get job' });
    }
  });
};
