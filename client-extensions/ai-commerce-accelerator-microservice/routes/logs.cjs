const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const fs = require('fs');

module.exports = (app, { logger, persistenceService, configService }) => {
  /**
   * Download the current active log file.
   */
  app.get(INTERNAL_API_PATHS.LOGS_DOWNLOAD, (req, res) => {
    try {
      const logFile = logger.logFile;
      if (!fs.existsSync(logFile)) {
        return res.status(404).json({
          success: false,
          message: 'Active log file not found',
        });
      }

      res.download(logFile, 'microservice-app.log');
    } catch (error) {
      logger.error('Failed to download log file', {
        error: error.message,
        operation: 'log-download',
      });
      res.status(500).json({
        success: false,
        message: 'Internal server error during log download',
      });
    }
  });

  /**
   * Clear the current log file.
   */
  app.delete(INTERNAL_API_PATHS.LOGS_CLEAR, (req, res) => {
    try {
      const logFile = logger.logFile;
      if (fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '');
      }
      res.json({ success: true, message: 'Active log file cleared' });
    } catch (error) {
      logger.error('Failed to clear log file', {
        error: error.message,
        operation: 'log-clear',
      });
      res.status(500).json({
        success: false,
        message: 'Internal server error during log clear',
      });
    }
  });

  /**
   * Manually cycle the log file.
   */
  app.post(INTERNAL_API_PATHS.LOGS_CYCLE, async (req, res) => {
    try {
      logger.info('Manual log cycle requested', {
        operation: 'log-cycle-manual',
      });

      const config = await configService.getLogManagementConfig(req.body);

      logger.cycleLogs();
      logger.pruneLogs(config.retentionCount);

      res.json({
        success: true,
        message: 'Logs cycled successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to manually cycle logs', {
        error: error.message,
        operation: 'log-cycle-manual',
      });
      res.status(500).json({
        success: false,
        message: `Failed to cycle logs: ${error.message}`,
      });
    }
  });

  /**
   * Get log management settings.
   */
  app.post(INTERNAL_API_PATHS.LOGS_SETTINGS, async (req, res) => {
    try {
      const config = await configService.getLogManagementConfig(req.body);
      res.json({ success: true, config });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * Update log management settings.
   */
  app.put(INTERNAL_API_PATHS.LOGS_SETTINGS, async (req, res) => {
    try {
      const { retentionCount, autoCycleTime, enabled } = req.body;

      const newConfig = {
        retentionCount: parseInt(retentionCount, 10) || 10,
        autoCycleTime: autoCycleTime || '00:00',
        enabled: enabled !== false,
      };

      await configService.saveLogManagementConfig(req.body, newConfig);

      res.json({
        success: true,
        message: 'Log management settings updated',
        config: newConfig,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * Extract logs for a specific workflow session.
   */
  app.get(INTERNAL_API_PATHS.LOGS_SESSION, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await persistenceService.getSession(sessionId);

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found',
        });
      }

      const logFile = logger.logFile;
      if (!fs.existsSync(logFile)) {
        return res.status(404).json({
          success: false,
          message: 'Log file not found',
        });
      }

      const startTime = new Date(session.created_at);
      const endTime = session.updated_at ? new Date(session.updated_at) : null;

      const content = fs.readFileSync(logFile, 'utf8');
      const blocks = content.split(/^\{/m);

      const searchRes = [];
      for (const block of blocks) {
        if (!block.trim()) continue;
        const fullBlock = '{' + block;

        if (fullBlock.includes(sessionId)) {
          searchRes.push(fullBlock);
        } else {
          const match = fullBlock.match(/"timestamp":\s*"(.*?)"/);
          if (match) {
            const logTime = new Date(match[1]);
            if (
              logTime >= startTime &&
              (!endTime || logTime <= new Date(endTime.getTime() + 10000))
            ) {
              searchRes.push(fullBlock);
            }
          }
        }
      }

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=session-${sessionId}.log`
      );
      res.send(searchRes.join('\n'));
    } catch (error) {
      logger.error('Failed to extract session logs', {
        error: error.message,
        operation: 'log-session-extract',
        sessionId: req.params.sessionId,
      });
      res.status(500).send(`Failed to extract logs: ${error.message}`);
    }
  });
};
