const { logger } = require('./utils/logger.cjs');

const { connectionSchema } = require('./utils/schemas.cjs');
const { ENV } = require('./utils/constants.cjs');
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
const path = require('path');

const app = express();
const server = http.createServer(app);

let ws;
try {
  ws = createWebSocketService({ server, logger });
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
  batchPollingService,
  cacheService,
  configService,
  deleteCoordinatorService,
  healthService,
  liferayService,
  orderGenerator,
  persistenceService,
  productGenerator,
  warehouseGenerator,
  oauthService,
} = require('./bootstrap.cjs')(ws);

const PORT = lookupConfig('server.port') || 3000;

const lxcDXPServerProtocol = lookupConfig(
  'com.liferay.lxc.dxp.server.protocol'
);

const domains = (() => {
  try {
    return lxcConfig.dxpDomains();
  } catch (e) {
    logger.warn('Could not determine Liferay Cloud domains, defaulting to empty list.', {
      error: e.message,
      operation: 'lxc-config-load',
    });
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
app.use(express.static(path.join(__dirname, '..')));

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
};

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
require('./routes/import.cjs')(apiV1Router, {
  ...routeCtx,
  batchCallbackService,
  ws: ws,
  configService,
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
  ws: ws,
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

      const result = await liferayService.testConnection(req.body);

      let openAiKeyAvailable = false;
      try {
        await configService.getOpenAIKey(req.body);
        openAiKeyAvailable = true;
      } catch (error) {
        openAiKeyAvailable = false;
        logger.debug('OpenAI key check failed', {
          correlationId,
          operation: 'openai-key-check',
          error: error.message,
        });
      }

      const openAiKeyMessage = openAiKeyAvailable
        ? 'OpenAI API key is configured and ready for AI features.'
        : 'OpenAI API key not found. Only demo mode will be available.';

      logger.info('Connection test successful', {
        correlationId,
        operation: 'test-connection',
        openAiKeyAvailable,
        message: result.message,
      });

      res.json({
        success: true,
        message: result.message,
        openAiKeyAvailable,
        openAiKeyMessage,
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

app.use((error, req, res, next) => {
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

  logger.debug('🔌 WebSocket server status:', {
    clients: ws.totalClients(),
  });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully', {
    operation: 'server-shutdown',
  });

  ws.stop();

  server.close(() => {
    logger.info('Server closed successfully', {
      operation: 'server-closed',
    });
    process.exit(0);
  });
});

module.exports = app;
