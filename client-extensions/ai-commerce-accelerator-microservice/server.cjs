const path = require('path');
const fs = require('fs');

// LOAD ENV FROM PROJECT ROOT (MUST BE BEFORE ANY OTHER IMPORTS)
try {
  const rootEnvPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(rootEnvPath)) {
    require('dotenv').config({ path: rootEnvPath });
    console.info(`[Bootstrap] Loaded environment from ${rootEnvPath}`);
  } else {
    console.info(`[Bootstrap] No .env found at ${rootEnvPath}`);
  }
} catch (err) {
  console.warn(`[Bootstrap] Error loading .env from root: ${err.message}`);
}

const { logger } = require('./utils/logger.cjs');
const { checkAndRebuild } = require('./scripts/ensure-native-modules.cjs');

// Ensure native modules (better-sqlite3) match current Node runtime
checkAndRebuild();

const { connectionSchema } = require('./utils/schemas.cjs');
const { ENV } = require('./utils/constants.cjs');
const { INTERNAL_API_PATHS } = require('./utils/internalApiPaths.cjs');
const { createWebSocketService } = require('./services/webSocketService.cjs');

const { lookupConfig, lxcConfig } = require('@rotty3000/config-node');

const {
  basicRateLimitMiddleware,
  correlationIdMiddleware,
  errorLoggingMiddleware,
  requestLoggingMiddleware,
  securityHeadersMiddleware,
  userContextMiddleware,
} = require('./middleware/loggingMiddleware.cjs');
const {
  inputValidationMiddleware,
  requestSigningMiddleware,
  requestSizeLimitMiddleware,
  sqlInjectionProtectionMiddleware,
  xssProtectionMiddleware,
} = require('./middleware/securityMiddleware.cjs');

const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
const server = http.createServer(app);

let ws;
let persistence;

const gracefulShutdown = async (signal) => {
  // Use console.info to ensure immediate visibility regardless of logger state
  console.info(`\n${signal} received, shutting down gracefully...`);

  if (process.stdin.isTTY) {
    process.stdin.pause();
  }

  logger.info(`${signal} received, shutting down gracefully`, {
    operation: 'server-shutdown',
    signal,
  });

  try {
    if (ws) {
      ws.close();
      logger.debug('WebSocket server stopped', {
        operation: 'server-shutdown',
      });
    }

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Server close timed out, forcing resolve', {
          operation: 'server-shutdown',
        });
        resolve();
      }, 5000);

      server.close((err) => {
        clearTimeout(timeout);
        if (err) {
          logger.error('Error during server close', {
            operation: 'server-shutdown',
            error: err.message,
          });
        } else {
          logger.info('HTTP server closed successfully', {
            operation: 'server-shutdown',
          });
        }
        resolve();
      });
    });

    if (persistence && persistence.close) {
      persistence.close();
      logger.info('Database connection closed', {
        operation: 'server-shutdown',
      });
    }

    if (logger.close) {
      await logger.close();
    }

    logger.info('Graceful shutdown completed', {
      operation: 'server-shutdown',
    });

    // Give the event loop and buffers a moment to flush
    setTimeout(() => {
      process.exit(0);
    }, 500);
  } catch (error) {
    console.error('Error during graceful shutdown', error);
    setTimeout(() => {
      process.exit(1);
    }, 500);
  }
};

(async () => {
  try {
    ws = createWebSocketService({ server, logger });
    ws.init(server);
  } catch (error) {
    logger.errorWithStack(error, {
      operation: 'websocket-init',
      message: 'Failed to initialize WebSocket service',
    });
    return;
  }

  const {
    accountGenerator,
    batchCallbackService,
    cacheService,
    configService,
    deleteCoordinatorService,
    healthService,
    liferayService,
    orderGenerator,
    persistenceService,
    progressService,
    productGenerator,
    warehouseGenerator,
    oauthService,
    workflowCoordinator,
  } = await require('./bootstrap.cjs')(ws);

  persistence = persistenceService;

  const PORT = lookupConfig('server.port') || 3000;

  const lxcDXPServerProtocol = lookupConfig(
    'com.liferay.lxc.dxp.server.protocol'
  );

  const domains = (() => {
    try {
      return lxcConfig.dxpDomains();
    } catch (e) {
      logger.debug(
        'Could not determine Liferay Cloud domains, defaulting to empty list.',
        {
          error: e.message,
          operation: 'lxc-config-load',
        }
      );
      return [];
    }
  })();

  const allowList =
    domains
      .map((domain) => `${lxcDXPServerProtocol}://${domain}`)
      .concat(lookupConfig('allow.list') || []) || [];

  logger.info('allowList', allowList);

  app.locals.oauthService = oauthService;
  app.locals.liferayService = liferayService;
  app.locals.triggerShutdown = gracefulShutdown;

  app.use(
    cors({
      origin: allowList,
      credentials: true,
      optionsSuccessStatus: 200,
      exposedHeaders: ['X-Correlation-ID'],
    })
  );

  app.set('trust proxy', true);

  app.use(express.json({ limit: '25mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  const apiV1Router = express.Router();

  apiV1Router.use(correlationIdMiddleware);
  apiV1Router.use(userContextMiddleware);
  apiV1Router.use(securityHeadersMiddleware);
  apiV1Router.use(requestLoggingMiddleware);
  apiV1Router.use(basicRateLimitMiddleware(200, 60000));
  apiV1Router.use(requestSizeLimitMiddleware(10485760));
  apiV1Router.use(sqlInjectionProtectionMiddleware);
  apiV1Router.use(xssProtectionMiddleware);
  apiV1Router.use(requestSigningMiddleware);

  const routeCtx = {
    batchCallbackService,
    liferayService,
    logger,
    persistenceService,
    progressService,
  };

  require('./routes/media.cjs')(apiV1Router, routeCtx);

  require('./routes/batch.cjs')(apiV1Router, {
    ...routeCtx,
    batchCallbackService,
    cacheService,
    configService,
    ws: ws,
  });
  require('./routes/cache.cjs')(apiV1Router, { ...routeCtx, cacheService });
  require('./routes/config.cjs')(apiV1Router, { ...routeCtx, configService });
  require('./routes/get.cjs')(apiV1Router, routeCtx);
  require('./routes/health.cjs')(apiV1Router, { ...routeCtx, healthService });
  require('./routes/queue.cjs')(apiV1Router, routeCtx);
  require('./routes/workflow.cjs')(apiV1Router, routeCtx);
  require('./routes/delete.cjs')(apiV1Router, {
    ...routeCtx,
    deleteCoordinatorService,
    configService,
  });
  require('./routes/export.cjs')(apiV1Router, { ...routeCtx, cacheService });
  require('./routes/logs.cjs')(apiV1Router, {
    ...routeCtx,
    persistenceService,
  });
  require('./routes/import.cjs')(apiV1Router, {
    ...routeCtx,
    batchCallbackService,
    ws: ws,
    configService,
    workflowCoordinator,
  });

  const generateCtx = {
    liferayService,
    productGenerator,
    accountGenerator,
    orderGenerator,
    warehouseGenerator,
    configService,
    cacheService,
    logger,
    progressService,
    persistenceService,
    batchCallbackService,
  };

  require('./routes/generate.cjs')(apiV1Router, generateCtx);

  apiV1Router.post(
    '/test-connection',
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      const correlationId = req.correlationId;
      try {
        logger.info('Testing connection to Liferay', {
          correlationId,
          operation: 'test-connection',
          liferayUrl: req.body.liferayUrl,
          clientId: req.body.clientId ? 'provided' : 'missing',
        });

        // Flush any cached configurations to ensure we pull the absolute latest
        // Liferay custom object entries before evaluating connection health
        configService.clearCache();

        const result = await liferayService.testConnection(req.body);

        // HARDENING: If successful, save these details to system_settings for background persistence
        if (persistenceService && result.status === 'connected') {
          if (req.body.liferayUrl) {
            persistenceService.saveSystemSetting(
              'active_liferay_url',
              req.body.liferayUrl
            );
          }
          if (req.body.clientId) {
            persistenceService.saveSystemSetting(
              'active_client_id',
              req.body.clientId
            );
          }
          if (req.body.clientSecret) {
            persistenceService.saveSystemSetting(
              'active_client_secret',
              req.body.clientSecret
            );
          }
        }

        const aiConfig = await configService.getAIConfig(req.body);
        const mediaProvider = (
          aiConfig?.mediaProvider || 'INHERIT'
        ).toUpperCase();

        let aiTextKeyAvailable = false;
        try {
          const key = await configService.getAIKey(req.body);
          aiTextKeyAvailable = !!key;
        } catch (_error) {
          aiTextKeyAvailable = false;
        }

        let aiMediaKeyAvailable = false;
        try {
          const mediaKey = await configService.getAIMediaKey(req.body);
          aiMediaKeyAvailable = !!mediaKey;
        } catch (_error) {
          aiMediaKeyAvailable = false;
        }

        const isMediaHealthy =
          mediaProvider === 'INHERIT'
            ? aiTextKeyAvailable
            : aiMediaKeyAvailable;
        const aiKeyAvailable = aiTextKeyAvailable && isMediaHealthy;

        const aiKeyMessage = aiKeyAvailable
          ? 'AI services are configured and ready for generation.'
          : !aiTextKeyAvailable
            ? 'Core AI API key not found. Generation will be disabled.'
            : 'Media AI API key not found. Media generation will be disabled.';

        logger.info('Connection test successful', {
          correlationId,
          operation: 'test-connection',
          aiTextKeyAvailable,
          aiMediaKeyAvailable,
          isMediaHealthy,
          message: result.message,
        });

        res.json({
          success: true,
          message: result.message,
          openAiKeyAvailable: aiTextKeyAvailable, // Legacy field
          aiKeyAvailable,
          aiTextKeyAvailable,
          aiMediaKeyAvailable: isMediaHealthy,
          aiKeyMessage,
        });
      } catch (error) {
        logger.error('Connection test failed', {
          correlationId,
          operation: 'test-connection',
          error: error.message,
        });

        if (error.response && error.response.data) {
          return res
            .status(error.response.status || 400)
            .json(error.response.data);
        }

        return res.status(400).json({
          success: false,
          message: error.message || 'Connection failed',
        });
      }
    }
  );

  app.use('/api/v1', apiV1Router);

  app.use(errorLoggingMiddleware);

  app.use((error, req, res, _) => {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'global-error-handler',
    });

    let status = 500;
    let message = 'Internal server error';

    if (error.response) {
      status = error.response.status || 500;
      message =
        error.response.data?.title || error.response.statusText || message;
    } else if (error.message) {
      message = error.message;
      if (error.status) {
        status = error.status;
      }
    }

    res.status(status).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.errorWithStack(error, { operation: 'uncaught-exception' });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', {
      operation: 'unhandled-rejection',
      reason: reason?.toString(),
      promise: promise,
      stack: reason?.stack,
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.success('Server started successfully', {
      operation: 'server-start',
      port: PORT,
      host: '0.0.0.0',
      environment: ENV.NODE_ENV,
      websocketEnabled: true,
    });
    logger.info(
      `Liferay Commerce AI Data Generator server running on http://0.0.0.0:${PORT}`
    );
    logger.info(`Frontend available at: http://localhost:${PORT}`);
    logger.info(`WebSocket server listening on ws://localhost:${PORT}`);
    logger.info(
      `Remote shutdown: curl -X POST http://localhost:${PORT}/api/v1${INTERNAL_API_PATHS.HEALTH_SHUTDOWN}`
    );

    logger.debug('🔌 WebSocket server status:', {
      clients: ws.clients.size,
    });

    // STARTUP TASKS (Background): Wait for Liferay and then sync keys
    (async () => {
      if (liferayService?.waitForLiferay) {
        await liferayService.waitForLiferay();
      }

      if (configService?.syncEnvironmentKeys) {
        await configService.syncEnvironmentKeys();
      }

      if (batchCallbackService?.recoverOrphanedSessions) {
        await batchCallbackService.recoverOrphanedSessions();
      }
    })().catch((err) => {
      logger.error('Startup background tasks failed', {
        error: err.message,
      });
    });

    // LOG MANAGEMENT SCHEDULER (Automatic Cycling)
    setInterval(async () => {
      try {
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(
          now.getMinutes()
        ).padStart(2, '0')}`;

        const logConfig = configService.getLogManagementConfigCached();

        if (
          logConfig &&
          logConfig.enabled &&
          logConfig.autoCycleTime === currentTime
        ) {
          logger.info('Automatic log cycle triggered', {
            operation: 'log-cycle-auto',
            time: currentTime,
          });
          logger.cycleLogs();
          logger.pruneLogs(logConfig.retentionCount);
        }
      } catch (_err) {
        // Silently catch to avoid interval crash
      }
    }, 60000); // Check every minute

    if (process.env.DRY_RUN === 'true') {
      logger.info('DRY_RUN enabled. Shutting down immediately.');
      setTimeout(() => gracefulShutdown('DRY_RUN_COMPLETED'), 500);
    }
  });
})();

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
