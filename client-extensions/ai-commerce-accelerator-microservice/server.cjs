const { lookupConfig } = require('@rotty3000/config-node');

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const { init: initWs } = require('./services/wsBus.cjs');
const { logger } = require('./utils/logger.cjs');
const { cacheService } = require('./services/cacheService.cjs');
const { BatchPollingService } = require('./services/batchPollingService.cjs');
const { connectionSchema } = require('./utils/schemas.cjs');
const {
  inputValidationMiddleware,
  requestSigningMiddleware,
  sqlInjectionProtectionMiddleware,
  xssProtectionMiddleware,
  requestSizeLimitMiddleware,
} = require('./middleware/securityMiddleware.cjs');
const {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  errorLoggingMiddleware,
  userContextMiddleware,
  securityHeadersMiddleware,
  basicRateLimitMiddleware,
} = require('./middleware/loggingMiddleware.cjs');

const {
  registerDataGenerationWorkers,
} = require('./workers/dataGenerationWorkers.cjs');

const liferayService = require('./services/liferayService.cjs');

const app = express();
const server = http.createServer(app);
const ws = initWs(server, logger);

const PORT = lookupConfig('server.port') || 3000;

// Initialize BatchPollingService with WebSocket server
console.log(
  '🔌 Initializing BatchPollingService with WebSocket server:',
  !!ws.wss
);
const batchPollingService = new BatchPollingService();

const ProductGenerator = require('./services/productGenerator.cjs');
const AccountGenerator = require('./services/accountGenerator.cjs');
const OrderGenerator = require('./services/orderGenerator.cjs');
const productGenerator = new ProductGenerator(batchPollingService);
const accountGenerator = new AccountGenerator(batchPollingService);
const orderGenerator = new OrderGenerator(batchPollingService);

// Initialize workers
registerDataGenerationWorkers();

// Core middleware with secure CORS configuration
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : [
          'http://localhost:8080',
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:5173',
        ],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

// Trust proxy for proper IP handling behind load balancers/proxies
app.set('trust proxy', true);

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '..')));

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Custom middleware
app.use(correlationIdMiddleware);
app.use(userContextMiddleware);
app.use(securityHeadersMiddleware);
app.use(requestLoggingMiddleware);
app.use(basicRateLimitMiddleware(200, 60000)); // 200 requests per minute
app.use(requestSizeLimitMiddleware(10485760)); // 10MB limit
app.use(sqlInjectionProtectionMiddleware);
app.use(xssProtectionMiddleware);
app.use(requestSigningMiddleware);

require('./routes/batch.cjs')(app, cacheService, batchPollingService, logger);
require('./routes/cache.cjs')(app, cacheService, logger);
require('./routes/config.cjs')(app, logger);
require('./routes/get.cjs')(app, liferayService, logger);
require('./routes/generate.cjs')(
  app,
  liferayService,
  productGenerator,
  accountGenerator,
  orderGenerator,
  logger
);
require('./routes/get.cjs')(app, liferayService, logger);
require('./routes/health.cjs')(app, logger);
require('./routes/queue.cjs')(app, logger);

app.post(
  '/api/test-connection',
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

      const { ConfigService } = require('./services/configService.cjs');
      const configServiceInstance = new ConfigService();

      let openAiKeyAvailable = false;
      try {
        // Pass the request configuration for OAuth authentication
        await configServiceInstance.getOpenAIKey(req.body);
        openAiKeyAvailable = true;
      } catch (error) {
        // Key not available or not configured
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

      // Use structured error response from liferayService if available
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

// Error handling middleware
app.use((error, req, res, next) => {
  logger.errorWithStack(error, {
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

// Error handling middleware (must be last)
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

// Global error handlers
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
    environment: process.env.NODE_ENV || 'development',
    websocketEnabled: true,
  });
  console.log(
    `Liferay Commerce AI Data Generator server running on http://0.0.0.0:${PORT}`
  );
  console.log(`Frontend available at: http://localhost:${PORT}`);
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);

  // Test WebSocket server is working
  console.log('🔌 WebSocket server status:', {
    listening: ws.wss.listening !== undefined ? ws.wss.listening : 'unknown',
    clients: ws.wss.clients.size,
    readyState: ws.wss.readyState !== undefined ? ws.wss.readyState : 'unknown',
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully', {
    operation: 'server-shutdown',
  });

  ws.stop();

  batchPollingService.stopAllPolling();

  server.close(() => {
    logger.info('Server closed successfully', {
      operation: 'server-closed',
    });
    process.exit(0);
  });
});

module.exports = app;
