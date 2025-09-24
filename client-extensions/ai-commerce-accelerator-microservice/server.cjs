const { lookupConfig } = require('@rotty3000/config-node');

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

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
const { v4: uuidv4 } = require('uuid');

const liferayService = require('./services/liferayService.cjs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = lookupConfig('server.port') || 3000;

// Initialize BatchPollingService with WebSocket server
console.log(
  '🔌 Initializing BatchPollingService with WebSocket server:',
  !!wss
);
const batchPollingService = new BatchPollingService(wss);

// Initialize ProductGenerator after WebSocket server is created
const ProductGeneratorClass = require('./services/productGenerator.cjs');
const productGenerator = new ProductGeneratorClass(wss);

// WebSocket connection handler
wss.on('connection', (ws, request) => {
  const correlationId = request.headers['x-correlation-id'] || uuidv4();
  ws.correlationId = correlationId;
  ws.isAlive = true;

  console.log(
    '🔌 WebSocket connection established from:',
    request.socket.remoteAddress
  );
  console.log('🔌 Total WebSocket clients now:', wss.clients.size);

  logger.info('WebSocket connection established', {
    operation: 'websocket-connect',
    correlationId,
    clientIP: request.socket.remoteAddress,
    connectedClients: wss.clients.size,
    origin: request.headers.origin,
    userAgent: request.headers['user-agent'],
  });

  // Set up ping/pong for connection health
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
      logger.error('Invalid WebSocket message', {
        operation: 'websocket-message-error',
        correlationId,
        error: error.message,
        rawMessage: message.toString(),
      });

      // Don't close connection on parse error, just log it
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: 'error', message: 'Invalid message format' })
        );
      }
    }
  });

  ws.on('close', (code, reason) => {
    logger.info('WebSocket connection closed', {
      operation: 'websocket-disconnect',
      correlationId,
      code,
      reason: reason ? reason.toString() : 'No reason provided',
      remainingClients: Math.max(0, wss.clients.size - 1),
    });
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error', {
      operation: 'websocket-error',
      correlationId,
      error: error.message,
      stack: error.stack,
    });
  });

  // Send welcome message
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'connected',
        correlationId,
        timestamp: new Date().toISOString(),
      })
    );
  }
});

// WebSocket health check - ping all clients every 30 seconds
const wsHealthCheck = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      logger.warn('Terminating unresponsive WebSocket connection', {
        operation: 'websocket-health-check',
        correlationId: ws.correlationId,
      });
      return ws.terminate();
    }

    ws.isAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 30000);

function handleWebSocketMessage(ws, data) {
  const { type, payload } = data;

  switch (type) {
    case 'subscribe-batch':
      if (payload?.batchId) {
        ws.batchId = payload.batchId;
        logger.debug('WebSocket subscribed to batch updates', {
          operation: 'websocket-subscribe-batch',
          correlationId: ws.correlationId,
          batchId: payload.batchId,
        });

        // Send acknowledgment
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'batch_subscription_confirmed',
              batchId: payload.batchId,
              timestamp: new Date().toISOString(),
            })
          );
        }
      }
      break;

    case 'unsubscribe-batch':
      const oldBatchId = ws.batchId;
      ws.batchId = null;
      logger.debug('WebSocket unsubscribed from batch updates', {
        operation: 'websocket-unsubscribe-batch',
        correlationId: ws.correlationId,
        previousBatchId: oldBatchId,
      });
      break;

    case 'ping':
      logger.debug('Received ping from client', {
        operation: 'websocket-ping-received',
        correlationId: ws.correlationId,
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString(),
          })
        );
      }
      break;

    case 'pong':
      logger.debug('Received pong from client', {
        operation: 'websocket-pong-received',
        correlationId: ws.correlationId,
      });
      ws.isAlive = true;
      break;

    default:
      logger.warn('Unknown WebSocket message type', {
        operation: 'websocket-unknown-message',
        correlationId: ws.correlationId,
        messageType: type,
        hasPayload: !!payload,
      });

      // Send error response for unknown message types
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${type}`,
            timestamp: new Date().toISOString(),
          })
        );
      }
  }
}

function broadcastBatchUpdate(batchId, update) {
  if (!wss) {
    logger.error('No WebSocket server available', {
      operation: 'websocket-broadcast-no-server',
      batchId,
    });
    console.log('❌ No WebSocket server available for broadcasting');
    return;
  }

  const message = JSON.stringify({
    type: 'batch_completed',
    batchId,
    entityType: update.entityType || 'products',
    successCount: update?.processedCount || update?.totalCount || 0,
    failureCount: update?.errorCount || 0,
    details: update,
    timestamp: new Date().toISOString(),
  });

  let broadcastCount = 0;
  let failedCount = 0;

  // Broadcast to all connected WebSocket clients
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        broadcastCount++;

        logger.debug('Broadcasted batch update to WebSocket client', {
          operation: 'websocket-broadcast-success',
          batchId,
          clientCorrelationId: client.correlationId,
          messageType: 'batch_completed',
        });
      } catch (error) {
        failedCount++;
        logger.error('Failed to broadcast to WebSocket client', {
          operation: 'websocket-broadcast-error',
          batchId,
          clientCorrelationId: client.correlationId,
          error: error.message,
        });
      }
    } else {
      logger.debug('Skipping closed WebSocket client', {
        operation: 'websocket-broadcast-skip',
        batchId,
        clientCorrelationId: client.correlationId,
        clientState: client.readyState,
      });
    }
  });

  logger.info('Batch update broadcast completed', {
    operation: 'batch-broadcast-complete',
    batchId,
    totalClients: wss.clients.size,
    broadcastSuccessful: broadcastCount,
    broadcastFailed: failedCount,
    messageSize: message.length,
  });

  // If no clients received the message, log a warning
  if (broadcastCount === 0) {
    logger.warn('No WebSocket clients received batch update', {
      operation: 'batch-broadcast-no-recipients',
      batchId,
      totalClients: wss.clients.size,
      messageData: message,
    });
  }
}

// Set up global broadcast function for session completion
global.broadcastSessionComplete = (sessionId, messageData) => {
  if (!wss) {
    console.log(
      '❌ No WebSocket server available for broadcasting session completion'
    );
    return;
  }

  let broadcastCount = 0;
  let failedCount = 0;

  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) {
      // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(messageData));
        broadcastCount++;
      } catch (error) {
        failedCount++;
        logger.error('Failed to send session completion WebSocket message', {
          operation: 'websocket-session-broadcast-error',
          error: error.message,
          sessionId,
          clientCorrelationId: ws.correlationId,
        });
      }
    }
  });

  logger.info('Session completion broadcast completed', {
    operation: 'session-broadcast-complete',
    sessionId,
    totalClients: wss.clients.size,
    broadcastSuccessful: broadcastCount,
    broadcastFailed: failedCount,
    messageSize: JSON.stringify(messageData).length,
  });

  console.log(
    `📡 Session completion broadcast: ${broadcastCount} clients notified for session ${sessionId}`
  );
};

// Make broadcastBatchUpdate globally available
global.broadcastBatchUpdate = broadcastBatchUpdate;

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
require('./routes/generate.cjs')(app, liferayService, productGenerator, logger);
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

// Get available catalogs
app.post('/api/get-catalogs', async (req, res) => {
  try {
    const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

    if (!liferayUrl || !clientId || !clientSecret || !localeCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required connection parameters',
      });
    }

    const catalogs = await liferayService.getCatalogs({
      liferayUrl,
      clientId,
      clientSecret,
      localeCode,
    });

    res.json({ success: true, catalogs });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'get-catalogs',
    });
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch catalogs',
    });
  }
});

// Get available channels
app.post('/api/get-channels', async (req, res) => {
  try {
    const { liferayUrl, clientId, clientSecret, localeCode } = req.body;
    const channels = await liferayService.getChannels({
      liferayUrl,
      clientId,
      clientSecret,
      localeCode,
    });
    res.json({ success: true, channels }); // <-- top-level channels
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'get-channels',
    });
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch channels',
    });
  }
});

// Get available currencies
app.post('/api/get-currencies', async (req, res) => {
  try {
    const { liferayUrl, clientId, clientSecret, localeCode, languageId } =
      req.body;

    // Fallback: if service is down, you return a fallback list in your existing code
    const currencies = await liferayService.getCurrencies({
      liferayUrl,
      clientId,
      clientSecret,
      localeCode,
      languageId,
    });

    res.json({ success: true, currencies });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'get-currencies',
    });
    // keep your fallback block here if you have one
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/get-languages', async (req, res) => {
  try {
    const { siteGroupId, ...config } = req.body;
    if (!siteGroupId) {
      return res
        .status(400)
        .json({ success: false, error: 'siteGroupId is required' });
    }
    const languages = await liferayService.getSiteLanguages(
      config,
      siteGroupId
    );
    res.json({ success: true, languages }); // top-level
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'get-languages',
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

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
    promise: promise?.toString(),
  });
});

// Start server with WebSocket support
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
  console.log(
    `WebSocket server listening for batch updates on ws://localhost:${PORT}`
  );

  // Test WebSocket server is working
  console.log('🔌 WebSocket server status:', {
    listening: wss.listening !== undefined ? wss.listening : 'unknown',
    clients: wss.clients.size,
    readyState: wss.readyState !== undefined ? wss.readyState : 'unknown',
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully', {
    operation: 'server-shutdown',
  });

  // Clear WebSocket health check interval
  if (wsHealthCheck) {
    clearInterval(wsHealthCheck);
  }

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, 'Server shutting down');
    }
  });

  batchPollingService.stopAllPolling();

  server.close(() => {
    logger.info('Server closed successfully', {
      operation: 'server-closed',
    });
    process.exit(0);
  });
});

module.exports = app;
