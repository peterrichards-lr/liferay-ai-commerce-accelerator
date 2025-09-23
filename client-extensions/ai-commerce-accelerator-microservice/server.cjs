const {
  toBool,
  toNum,
  parseJSON,
  bufToDataUrl,
} = require('./utils/normalize.cjs');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { logger } = require('./utils/logger.cjs');
const { HealthService } = require('./services/healthService.cjs');
const { cacheService } = require('./services/cacheService.cjs');
const { queueService } = require('./services/queueService.cjs');
const { BatchPollingService } = require('./services/batchPollingService.cjs');
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
const accountGenerator = require('./services/accountGenerator.cjs');
const orderGenerator = require('./services/orderGenerator.cjs');
const { MockDataGenerator } = require('./services/mockDataGenerator.cjs');
const liferayService = require('./services/liferayService.cjs');
const configService = require('./services/configService.cjs'); // Assuming configService is available
const {
  registerDataGenerationWorkers,
} = require('./workers/dataGenerationWorkers.cjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3001;
const healthService = new HealthService();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file (tune as needed)
});

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

// Queue status endpoint
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

// Job status endpoint
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

// Cache stats endpoint
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

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const health = await healthService.runAllHealthChecks();
    const statusCode =
      health.status === 'healthy'
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

// OpenAI API key status endpoint
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

// Detailed health endpoint
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

// Kubernetes probes
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

// Validation endpoints to check data availability
app.post('/api/validate/products', async (req, res) => {
  try {
    const { liferayUrl, clientId, clientSecret, catalogId, requiredCount } =
      req.body;

    const config = {
      liferayUrl,
      clientId,
      clientSecret,
      catalogId: parseInt(catalogId),
    };

    const products = await liferayService.getProducts(config, config.catalogId);

    res.json({
      available: products.length > 0,
      count: products.length,
      required: requiredCount || 1,
      sufficient: products.length >= (requiredCount || 1),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'validate-products',
    });
    res.json({
      available: false,
      count: 0,
      required: req.body.requiredCount || 1,
      sufficient: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/validate/accounts', async (req, res) => {
  try {
    const { liferayUrl, clientId, clientSecret, requiredCount } = req.body;

    const config = {
      liferayUrl,
      clientId,
      clientSecret,
    };

    const accounts = await liferayService.getAccounts(config);

    res.json({
      available: accounts.length > 0,
      count: accounts.length,
      required: requiredCount || 1,
      sufficient: accounts.length >= (requiredCount || 1),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'validate-accounts',
    });
    res.json({
      available: false,
      count: 0,
      required: req.body.requiredCount || 1,
      sufficient: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Validation schemas
const connectionSchema = {
  liferayUrl: { type: 'string', required: true, pattern: /^https?:\/\/.+/ },
  clientId: { type: 'string', required: true, minLength: 1 },
  clientSecret: { type: 'string', required: true, minLength: 1 },
};

const generateDataSchema = {
  liferayUrl: { type: 'string', required: true, pattern: /^https?:\/\/.+/ },
  clientId: { type: 'string', required: true },
  clientSecret: { type: 'string', required: true },
  catalogId: { type: 'number', required: true, integer: true },
  productCount: { type: 'number', min: 1, max: 100, integer: true },
  accountCount: { type: 'number', min: 1, max: 50, integer: true },
  orderCount: { type: 'number', min: 1, max: 100, integer: true },
  batchSize: { type: 'number', min: 1, max: 20, integer: true },
  aiModel: {
    type: 'string',
    enum: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  channelId: { type: 'number', required: false, integer: true },
  currencyCode: { type: 'string', required: false },
  localeCode: { type: 'string', required: false },
  selectedLanguages: { type: 'array', required: false },
  microserviceUrl: { type: 'string', required: false },
};

const generateOrdersSchema = {
  liferayUrl: { type: 'string', required: true, pattern: /^https?:\/\/.+/ },
  clientId: { type: 'string', required: true },
  clientSecret: { type: 'string', required: true },
  catalogId: { type: 'number', required: true, integer: true },
  channelId: { type: 'number', required: true, integer: true },
  currencyCode: { type: 'string', required: true },
  orderCount: { type: 'number', min: 1, max: 100, integer: true },
  batchSize: { type: 'number', min: 1, max: 20, integer: true },
  aiModel: {
    type: 'string',
    enum: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  localeCode: { type: 'string', required: false },
  selectedLanguages: { type: 'array', required: false },
  microserviceUrl: { type: 'string', required: false },
  demoMode: { type: 'boolean', required: false },
};

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

      // Do whatever your liferayService does to validate OAuth + reachability:
      const { success, message, openAiKeyAvailable, openAiKeyMessage } =
        await liferayService.testConnection(req.body); // POST body is flat (no auth nesting)

      if (!success) {
        return res.status(400).json({
          success: false,
          message: message || 'Failed to establish connection.',
          openAiKeyAvailable: false,
          openAiKeyMessage,
        });
      }

      logger.info('Connection test succeeded', {
        correlationId,
        operation: 'test-connection',
        openAiKeyAvailable,
      });

      return res.json({
        success: true,
        message: message || 'Successfully connected.',
        openAiKeyAvailable: Boolean(openAiKeyAvailable),
        openAiKeyMessage,
      });
    } catch (error) {
      logger.error('Connection test failed', {
        correlationId,
        operation: 'test-connection',
        error: error.message,
      });

      // If your service attaches structured errors, forward them
      if (error.response && error.response.data) {
        return res
          .status(error.response.status || 400)
          .json(error.response.data);
      }

      return res
        .status(400)
        .json({
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

app.post(
  '/api/generate/products',
  inputValidationMiddleware(generateDataSchema),
  async (req, res) => {
    try {
      const {
        liferayUrl,
        clientId,
        clientSecret,
        catalogId,
        channelId,
        currencyCode,
        localeCode,
        aiModel,
        selectedLanguages,
        productCount,
        productCategories,
        generatePriceLists,
        generateBulkPricing,
        generateTierPricing,
        generateAttachments,
        generateSpecifications,
        generatePDFs,
        pdfRatio,
        batchSize,
        demoMode,
        microserviceUrl,
        pollingDelay,
      } = req.body;

      if (!req.body.count && !productCount) {
        return res.status(400).json({
          success: false,
          error: 'Product count is required',
        });
      }

      if (!req.body.categories && !productCategories) {
        return res.status(400).json({
          success: false,
          error: 'Product categories are required',
        });
      }

      if (!batchSize) {
        return res.status(400).json({
          success: false,
          error: 'Batch size is required',
        });
      }

      if (!aiModel) {
        return res.status(400).json({
          success: false,
          error: 'AI model is required',
        });
      }

      const actualCount = req.body.count || productCount;
      const actualBatchSize =
        actualCount > 5 ? Math.max(batchSize, 5) : batchSize;

      // Determine microservice URL - use environment variable or construct from request
      let microserviceUrlFromConfig = microserviceUrl;
      if (
        !microserviceUrlFromConfig ||
        microserviceUrlFromConfig === 'null' ||
        microserviceUrlFromConfig === 'undefined'
      ) {
        // Try to construct from environment or request headers
        const protocol =
          req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        const host =
          req.headers['x-forwarded-host'] ||
          req.headers.host ||
          `localhost:${PORT}`;
        microserviceUrlFromConfig = `${protocol}://${host}`;
        console.log(
          `Constructed microservice URL: ${microserviceUrlFromConfig}`
        );
      }

      console.log(`Using microservice URL: ${microserviceUrlFromConfig}`);

      // Validate the constructed URL
      try {
        new URL(microserviceUrlFromConfig);
      } catch (urlError) {
        console.warn(
          `Invalid microservice URL constructed: ${microserviceUrlFromConfig}, falling back to null`
        );
        microserviceUrlFromConfig = null;
      }

      let config = {
        liferayUrl: req.body.liferayUrl,
        clientId: req.body.clientId,
        clientSecret: req.body.clientSecret,
        catalogId: parseInt(req.body.catalogId),
        channelId: req.body.channelId ? parseInt(req.body.channelId) : null,
        currencyCode: req.body.currencyCode || 'USD',
        localeCode: req.body.localeCode || 'en-US',
        selectedLanguages: req.body.selectedLanguages || ['en-US'],
        aiModel: req.body.aiModel || 'gpt-4o',
        demoMode: req.body.demoMode || false,
        microserviceUrl:
          req.body.microserviceUrl && req.body.microserviceUrl !== 'null'
            ? req.body.microserviceUrl
            : null,
        pollingDelay: parseInt(req.body.pollingDelay) || 10,
      };

      let options = {
        count: req.body.count || 10,
        categories: req.body.categories || [],
        generatePriceLists: req.body.generatePriceLists || false,
        generateBulkPricing: req.body.generateBulkPricing || false,
        generateTierPricing: req.body.generateTierPricing || false,
        generateImages: req.body.generateImages || false,
        imageWidth: req.body.imageWidth || 1024,
        imageHeight: req.body.imageHeight || 1024,
        imageQuality: req.body.imageQuality || 'standard',
        imageStyle: req.body.imageStyle || 'photographic',
        imageRatio: req.body.imageRatio || 25,
        generateSpecifications: req.body.generateSpecifications || false,
        generateSkuVariants: req.body.generateSkuVariants || false,
        generatePDFs: req.body.generatePDFs || false,
        pdfRatio: req.body.pdfRatio || 10,
        batchSize: parseInt(req.body.batchSize) || 5,
        pollingDelay: parseInt(req.body.pollingDelay) || 10,
        demoMode: req.body.demoMode || false,
        useCustomImage: req.body.useCustomImage || false,
        useCustomPDF: req.body.useCustomPDF || false,
        microserviceUrl:
          req.body.microserviceUrl && req.body.microserviceUrl !== 'null'
            ? req.body.microserviceUrl
            : null,
      };

      logger.info('Starting product generation', {
        correlationId: req.correlationId,
        operation: 'generate-products',
        productCount: actualCount,
        demoMode: !!options.demoMode,
        categories: options.categories?.length || 0,
        microserviceUrl: microserviceUrlFromConfig,
      });

      if (options.demoMode) {
        return handleDemoProductGeneration(req, res);
      }

      if (options.generatePDFs && options.pdfRatio > 0) {
        const expectedPDFs = Math.ceil(actualCount * (options.pdfRatio / 100));
        logger.info('PDF generation configured', {
          correlationId: req.correlationId,
          operation: 'generate-products',
          expectedPDFs,
          pdfRatio: options.pdfRatio,
          productCount: actualCount,
        });
      }

      const results = await productGenerator.generateProducts(config, {
        count: actualCount,
        categories: options.categories,
        batchSize: actualBatchSize,
        generateSkuVariants: generateSkuVariants,
        generateSpecifications: generateSpecifications,
        generateAttachments: generateAttachments,
        generatePriceLists: generatePriceLists,
        generateBulkPricing: generateBulkPricing,
        generateTierPricing: generateTierPricing,
        generatePDFs: generatePDFs,
        generateImages: req.body.generateImages,
        pdfRatio: pdfRatio,
        imageRatio: req.body.imageRatio || 0,
        demoMode: demoMode,
      });

      // Safe calculation of total products created
      let totalProductsCreated = 0;
      if (results.created) {
        totalProductsCreated = results.created;
      } else if (results.products && Array.isArray(results.products)) {
        totalProductsCreated = results.products.reduce(
          (sum, p) => sum + (p.productCount || 0),
          0
        );
      }

      // Emit progress update via WebSocket for PDF generation
      if (generatePDFs && results.pdfProgress) {
        global.broadcastProgress({
          type: 'generation-progress',
          generator: 'product',
          subType: 'pdf',
          batchId: results.batchId,
          progress: results.pdfProgress.current / results.pdfProgress.total,
          current: results.pdfProgress.current,
          total: results.pdfProgress.total,
          timestamp: new Date().toISOString(),
        });
      }

      // Emit progress update via WebSocket for Image generation
      if (req.body.generateImages && results.imageProgress) {
        global.broadcastProgress({
          type: 'generation-progress',
          generator: 'product',
          subType: 'image',
          batchId: results.batchId,
          progress: results.imageProgress.current / results.imageProgress.total,
          current: results.imageProgress.current,
          total: results.imageProgress.total,
          timestamp: new Date().toISOString(),
        });
      }

      logger.success('Product generation completed successfully', {
        correlationId: req.correlationId,
        operation: 'generate-products',
        productsCreated: totalProductsCreated,
        categoriesProcessed: results.products ? results.products.length : 0,
        batchCount: results.products ? results.products.length : 0,
        resultStructure: {
          hasCreated: !!results.created,
          hasProducts: !!results.products,
          isProductsArray: Array.isArray(results.products),
          resultKeys: Object.keys(results),
        },
      });

      console.log(
        `[${new Date().toLocaleTimeString()}] Successfully generated ${totalProductsCreated} products`
      );

      res.json({
        success: true,
        message: 'Products generated successfully',
        count: totalProductsCreated,
        products: results.products || [],
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Ensure we always have a meaningful error message
      const errorMessage =
        error.message ||
        error.toString() ||
        'Unknown error occurred during product generation';

      // Enhanced error logging with full request/response context
      logger.error('Product generation failed - Enhanced Debug Info', {
        correlationId: req.correlationId,
        operation: 'generate-products',
        error: errorMessage,
        errorName: error.name || 'UnknownError',
        errorStack: error.stack,
        errorType: typeof error,
        errorDetails: error,
        requestDetails: {
          method: req.method,
          url: req.url,
          body: req.body,
          headers: req.headers,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        },
        configDetails: {
          liferayUrl: config?.liferayUrl,
          catalogId: config?.catalogId,
          clientId: config?.clientId,
          clientSecret: config?.clientSecret ? '[REDACTED]' : undefined,
          aiModel: config?.aiModel,
        },
        optionsDetails: {
          productCount: options?.count,
          batchSize: options?.batchSize,
        },
      });

      console.error('=== PRODUCT GENERATION ERROR DEBUG ===');
      console.error('Error Message:', errorMessage);
      console.error('Error Name:', error.name);
      console.error('Error Type:', typeof error);
      // Log request body with sensitive fields redacted
      const sanitizedBody = { ...req.body };
      if (sanitizedBody.clientSecret) sanitizedBody.clientSecret = '[REDACTED]';
      if (sanitizedBody.openaiApiKey) sanitizedBody.openaiApiKey = '[REDACTED]';
      if (sanitizedBody.Authorization)
        sanitizedBody.Authorization = '[REDACTED]';
      console.error('Request Body:', JSON.stringify(sanitizedBody, null, 2));
      console.error(
        'Config Object:',
        JSON.stringify(
          req.body.config,
          (key, value) => (key === 'clientSecret' ? '[REDACTED]' : value),
          2
        )
      );
      // Log options with sensitive fields redacted
      const sanitizedOptions = req.body.options ? { ...req.body.options } : {};
      if (sanitizedOptions.clientSecret)
        sanitizedOptions.clientSecret = '[REDACTED]';
      if (sanitizedOptions.openaiApiKey)
        sanitizedOptions.openaiApiKey = '[REDACTED]';
      console.error(
        'Options Object:',
        JSON.stringify(sanitizedOptions, null, 2)
      );
      console.error('Full Error Object:', JSON.stringify(error, null, 2));
      console.error('Error Stack:', error.stack);
      console.error('=== END ERROR DEBUG ===');

      res.status(500).json({
        success: false,
        error: `Product generation failed: ${errorMessage}`,
        details: error.stack,
      });
    }
  }
);

// Demo mode handlers
async function handleDemoProductGeneration(req, res) {
  const {
    liferayUrl,
    clientId,
    clientSecret,
    catalogId,
    count,
    categories,
    generatePDFs,
    pdfRatio,
    selectedLanguages,
    batchSize,
    microserviceUrl,
    pollingDelay,
  } = req.body;

  try {
    console.log(
      `Demo mode: Generating ${count} mock products using batch endpoint`
    );

    const validMicroserviceUrl =
      microserviceUrl &&
      microserviceUrl !== 'undefined' &&
      microserviceUrl !== 'null'
        ? microserviceUrl
        : null;

    const config = {
      liferayUrl,
      clientId,
      clientSecret,
      catalogId,
      microserviceUrl: validMicroserviceUrl,
      demoMode: true,
      selectedLanguages,
      pollingDelay: pollingDelay,
    };

    const options = {
      count: count,
      categories: categories,
      catalogId: config.catalogId,
      generatePDFs,
      pdfRatio: pdfRatio,
      generateImages: req.body.generateImages,
      imageRatio: req.body.imageRatio || 0,
      batchSize: batchSize,
      pollingDelay: pollingDelay,
      demoMode: true,
    };

    // Use the same productGenerator.generateProducts method as live mode
    const result = await productGenerator.generateProducts(config, options);

    // Calculate PDFs
    const expectedPDFs =
      generatePDFs && pdfRatio > 0 ? Math.ceil(count * (pdfRatio / 100)) : 0;

    // Emit progress update via WebSocket for PDF generation
    if (generatePDFs && result.pdfProgress) {
      global.broadcastProgress({
        type: 'generation-progress',
        generator: 'product',
        subType: 'pdf',
        batchId: result.products[0]?.batchId,
        progress: result.pdfProgress.current / result.pdfProgress.total,
        current: result.pdfProgress.current,
        total: result.pdfProgress.total,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit progress update via WebSocket for Image generation
    if (req.body.generateImages && result.imageProgress) {
      global.broadcastProgress({
        type: 'generation-progress',
        generator: 'product',
        subType: 'image',
        batchId: result.products[0]?.batchId,
        progress: result.imageProgress.current / result.imageProgress.total,
        current: result.imageProgress.current,
        total: result.imageProgress.total,
        timestamp: new Date().toISOString(),
      });
    }

    // Fix for undefined products log message
    console.log(
      `Demo: Successfully initiated batch creation of ${
        result.created || 0
      } products`
    );

    res.json({
      success: true,
      batchId: result.products[0]?.batchId,
      count: result.created || 0, // Ensure count is a number
      pdfCount: expectedPDFs,
      errors: result.errors,
      status: result.products[0]?.status || 'submitted',
      demo: true,
      batch: true,
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'demo-generate-products',
    });
    res.status(500).json({
      success: false,
      error: 'Demo product generation failed',
      demo: true,
    });
  }
}

async function handleDemoAccountGeneration(req, res) {
  const {
    liferayUrl,
    clientId,
    clientSecret,
    count,
    microserviceUrl,
    pollingDelay,
    batchSize,
  } = req.body;

  try {
    logger.info('Demo account generation started', {
      correlationId: req.correlationId,
      operation: 'demo-generate-accounts',
      accountCount: count,
      batchSize: batchSize,
      pollingDelay: pollingDelay,
    });

    console.log(
      `Demo mode: Generating ${count} mock accounts using batch endpoint with batch size: ${batchSize}`
    );

    const validPollingDelay = parseInt(pollingDelay) || 10;
    const validBatchSize = parseInt(batchSize) || 5;

    const config = {
      liferayUrl,
      clientId,
      clientSecret,
      demoMode: true,
      microserviceUrl,
      pollingDelay: validPollingDelay,
      batchSize: validBatchSize,
      count: parseInt(count),
    };

    const shouldUseBatch = count > 5;
    const actualBatchSize = shouldUseBatch ? Math.max(validBatchSize, 5) : 1;

    const result = await accountGenerator.generateAccounts(config, {
      count: count,
      batchSize: actualBatchSize,
    });

    // Handle both batch and individual responses
    if (result.batchId) {
      // Batch response
      logger.info('Demo account batch generation completed successfully', {
        correlationId: req.correlationId,
        operation: 'demo-generate-accounts',
        batchId: result.batchId,
        accountCount: result.count,
        usedBatch: true,
      });

      res.json({
        success: true,
        batchId: result.batchId,
        count: result.count,
        status: result.status,
        message: result.message,
        demoMode: true,
        batch: true,
      });
    } else if (result.success) {
      // Individual response
      logger.info('Demo account generation completed successfully', {
        correlationId: req.correlationId,
        operation: 'demo-generate-accounts',
        accountCount: result.created,
        usedBatch: false,
      });

      res.json({
        success: true,
        count: result.created,
        errors: result.errors,
        message: `Successfully generated ${result.created} demo accounts using individual creation`,
        demoMode: true,
        batch: false,
      });
    } else {
      logger.error('Demo account generation failed', {
        correlationId: req.correlationId,
        operation: 'demo-generate-accounts',
        error: result.error || 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: result.error || 'Account generation failed',
        demoMode: true,
      });
    }
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'demo-generate-accounts',
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Demo account generation failed',
      demo: true,
    });
  }
}

async function handleDemoOrderGeneration(req, res) {
  const {
    liferayUrl,
    clientId,
    clientSecret,
    catalogId,
    channelId,
    currencyCode,
    localeCode,
    aiModel,
    selectedLanguages,
    orderCount,
    batchSize,
    microserviceUrl,
    pollingDelay,
  } = req.body;

  try {
    console.log(
      `Demo mode: Generating ${orderCount} mock orders using consistent service approach`
    );

    // Validate catalogId is provided as integer
    if (!catalogId || typeof catalogId !== 'number' || catalogId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'catalogId is required and must be a positive integer',
        demo: true,
      });
    }

    const config = {
      liferayUrl,
      clientId,
      clientSecret,
      catalogId,
      channelId,
      currencyCode,
      localeCode,
      microserviceUrl,
      aiModel: aiModel || 'gpt-4o',
      selectedLanguages,
      demoMode: true,
      pollingDelay: pollingDelay,
    };

    const options = {
      count: orderCount,
      batchSize: batchSize,
      catalogId: config.catalogId,
      enableRetry: req.body.enableRetry,
    };

    // Use the same orderGenerator.generateOrders method as live mode
    const result = await orderGenerator.generateOrders(config, options);

    res.json({
      success: true,
      count: result.created,
      errors: result.errors,
      data: result.orders,
      demo: true,
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'demo-generate-orders',
    });

    // Check for validation errors that should be warnings
    const errorMessage = error.message || 'Demo order generation failed';
    let statusCode = 500;

    if (
      errorMessage.includes('No products available') ||
      errorMessage.includes('No accounts available')
    ) {
      statusCode = 400; // Bad request for validation errors
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      demo: true,
    });
  }
}

// Batch callback endpoint for Liferay to call when batch processing is submitted
app.post('/api/batch/callback', async (req, res) => {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();

  try {
    // Log batch submission callback
    logger.info('Received batch submission callback from Liferay', {
      correlationId: correlationId,
      operation: 'batch-callback',
      batchId: req.body?.batchId,
      status: req.body?.status,
      bodyKeys: req.body ? Object.keys(req.body) : [],
    });

    console.log('=== BATCH SUBMISSION CALLBACK ===');
    console.log('Batch ID:', req.body?.batchId || 'Not provided');
    console.log('Status:', req.body?.status || 'Not provided');
    // Log callback data with sensitive fields redacted
    const sanitizedCallback = { ...req.body };
    if (sanitizedCallback.clientSecret)
      sanitizedCallback.clientSecret = '[REDACTED]';
    if (sanitizedCallback.openaiApiKey)
      sanitizedCallback.openaiApiKey = '[REDACTED]';
    console.log(
      'Full callback data:',
      JSON.stringify(sanitizedCallback, null, 2)
    );
    console.log('=== END CALLBACK ===');

    // Store initial batch submission data
    if (req.body?.batchId) {
      const batchId = req.body.batchId;

      // Cache the submission callback
      cacheService.set(
        `batch:${batchId}:submission`,
        {
          status: req.body.status,
          submittedAt: new Date().toISOString(),
          rawCallback: req.body,
        },
        3600000 // 1 hour cache
      );

      // Try to get the config from cache to start polling
      const batchConfig = cacheService.get(`batch:${batchId}:config`);
      if (batchConfig) {
        // Get poll interval from config with defaults
        const pollInterval = Math.max(batchConfig.pollInterval || 5000, 2000); // Minimum 2 seconds
        const maxPollAttempts = batchConfig.maxPollAttempts || 120;

        logger.info('Starting batch status polling', {
          operation: 'batch-polling-init',
          batchId,
          pollInterval,
          maxPollAttempts,
          correlationId,
        });

        // Determine entity type from batch config or cache
        const entityType = batchConfig.entityType || 'products'; // Default to products

        // Start polling for batch completion
        batchPollingService.startPolling(batchId, batchConfig, {
          pollInterval,
          maxPollAttempts,
          onStatusChange: (statusUpdate) => {
            logger.debug('Batch status update', {
              operation: 'batch-status-update',
              batchId,
              status: statusUpdate.status,
              processedCount: statusUpdate.processedCount,
              totalCount: statusUpdate.totalCount,
              entityType: entityType,
            });

            // Don't broadcast status changes, only final completion
          },
          onComplete: (results) => {
            logger.success('Batch processing completed', {
              operation: 'batch-complete',
              batchId,
              processedCount: results.processedCount,
              totalCount: results.totalCount,
              entityType: entityType,
            });

            // Broadcast completion to WebSocket clients with proper message format
            broadcastBatchUpdate(batchId, {
              status: 'completed',
              entityType: entityType,
              data: results,
            });

            console.log(
              `✅ Batch ${batchId} (${entityType}) completed - ${results.processedCount}/${results.totalCount} items processed`
            );
          },
          onError: (error) => {
            logger.error('Batch processing error', {
              operation: 'batch-error',
              batchId,
              error: error.message,
              entityType: entityType,
            });

            // Broadcast error to WebSocket clients
            const errorMessage = JSON.stringify({
              type: 'batch_failed',
              batchId,
              entityType: entityType,
              error: error.message,
              timestamp: new Date().toISOString(),
            });

            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(errorMessage);
              }
            });

            console.log(
              `❌ Batch ${batchId} (${entityType}) error: ${error.message}`
            );
          },
        });
      } else {
        logger.warn('No config found for batch, cannot start polling', {
          operation: 'batch-callback-no-config',
          batchId,
          correlationId,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Batch callback received successfully',
      correlationId: correlationId,
      pollingStarted:
        !!req.body?.batchId &&
        !!cacheService.get(`batch:${req.body.batchId}:config`),
    });
  } catch (error) {
    logger.error('Error processing batch callback', {
      correlationId: correlationId,
      operation: 'batch-callback',
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to process batch callback',
      correlationId: correlationId,
    });
  }
});

// Get batch status endpoint
app.get('/api/batch/:batchId/status', async (req, res) => {
  try {
    const { batchId } = req.params;

    // Check for final results first
    const finalResults = cacheService.get(`batch:${batchId}:final`);
    if (finalResults) {
      return res.json({
        success: true,
        batchId,
        ...finalResults,
        isFinal: true,
      });
    }

    // Check current polling status
    const currentStatus = cacheService.get(`batch:${batchId}:status`);
    if (currentStatus) {
      const pollingStatus = batchPollingService.getPollingStatus(batchId);

      return res.json({
        success: true,
        batchId,
        ...currentStatus,
        polling: pollingStatus,
        isFinal: false,
      });
    }

    // Check submission data
    const submissionData = cacheService.get(`batch:${batchId}:submission`);
    if (submissionData) {
      return res.json({
        success: true,
        batchId,
        ...submissionData,
        status: 'SUBMITTED',
        isFinal: false,
      });
    }

    res.status(404).json({
      success: false,
      error: 'Batch not found or expired',
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'get-batch-status',
      batchId: req.params.batchId,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get batch status',
    });
  }
});

// Get polling configuration endpoint
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

const generateAccountsSchema = {
  liferayUrl: { type: 'string', required: true },
  clientId: { type: 'string', required: true },
  clientSecret: { type: 'string', required: true },
  count: { type: 'number', min: 1, max: 50, integer: true },
  batchSize: { type: 'number', min: 1, max: 20, integer: true },
  aiModel: {
    type: 'string',
    enum: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  selectedLanguages: { type: 'array', required: false },
  microserviceUrl: { type: 'string', required: false },
  demoMode: { type: 'boolean', required: false },
};

app.post(
  '/api/generate/products',
  // Accept multipart (files optional). If JSON is sent, this is skipped safely.
  upload.fields([{ name: 'customImageFile' }, { name: 'customPDFFile' }]),
  // Normalize multipart string fields → correct types BEFORE validation
  (req, _res, next) => {
    const b = req.body || {};

    // Arrays/objects that arrive as JSON strings
    if (b.categories) b.categories = parseJSON(b.categories) || [];
    if (b.selectedLanguages)
      b.selectedLanguages = parseJSON(b.selectedLanguages) || [];

    // Numbers
    [
      'count',
      'imageWidth',
      'imageHeight',
      'imageRatio',
      'pdfRatio',
      'batchSize',
      'pollingDelay',
      'catalogId',
      'channelId',
      'siteGroupId',
    ].forEach((k) => (b[k] = toNum(b[k])));

    // Booleans
    [
      'generatePriceLists',
      'generateBulkPricing',
      'generateTierPricing',
      'generateImages',
      'generateSpecifications',
      'generateSkuVariants',
      'generatePDFs',
      'demoMode',
      'generateAttachments',
    ].forEach((k) => (b[k] = toBool(b[k])));

    next();
  },
  // Your existing validation schema for generation
  inputValidationMiddleware(generateDataSchema),
  async (req, res) => {
    try {
      const b = req.body || {};

      // Convert uploaded files → data URLs (if present)
      const imgFile = (req.files?.customImageFile || [])[0];
      const pdfFile = (req.files?.customPDFFile || [])[0];

      let customImageDataUrl, customPdfDataUrl, customImageName, customPdfName;

      if (imgFile?.buffer?.length) {
        customImageDataUrl = bufToDataUrl(
          imgFile.buffer,
          imgFile.mimetype || 'image/jpeg'
        );
        customImageName = imgFile.originalname || 'image';
      }
      if (pdfFile?.buffer?.length) {
        customPdfDataUrl = bufToDataUrl(
          pdfFile.buffer,
          pdfFile.mimetype || 'application/pdf'
        );
        customPdfName = pdfFile.originalname || 'file.pdf';
      }

      // If the client sometimes sends base64 in JSON, honor it as fallback
      if (!customImageDataUrl && b.customImageBase64) {
        customImageDataUrl = /^data:/.test(b.customImageBase64)
          ? b.customImageBase64
          : `data:image/jpeg;base64,${b.customImageBase64}`;
        customImageName = b.customImageName || customImageName || 'image';
      }
      if (!customPdfDataUrl && b.customPdfBase64) {
        customPdfDataUrl = /^data:/.test(b.customPdfBase64)
          ? b.customPdfBase64
          : `data:application/pdf;base64,${b.customPdfBase64}`;
        customPdfName = b.customPdfName || customPdfName || 'file.pdf';
      }

      // Build the flat payload to your generator/Liferay
      const payload = {
        // connection + i18n
        liferayUrl: b.liferayUrl,
        microserviceUrl: b.microserviceUrl,
        localeCode: b.localeCode,
        languageId: b.languageId,
        pollingDelay: b.pollingDelay,

        // commerce
        catalogId: b.catalogId,
        channelId: b.channelId,
        siteGroupId: b.siteGroupId,
        currencyCode: b.currencyCode,

        // generation config
        aiModel: b.aiModel,
        batchSize: b.batchSize,
        selectedLanguages: b.selectedLanguages || [],
        categories: b.categories || [],
        count: b.count,

        // toggles & params
        generatePriceLists: b.generatePriceLists,
        generateBulkPricing: b.generateBulkPricing,
        generateTierPricing: b.generateTierPricing,
        generateAttachments: b.generateAttachments,
        generateSpecifications: b.generateSpecifications,
        generateSkuVariants: b.generateSkuVariants,
        generateImages: b.generateImages,
        imageWidth: b.imageWidth,
        imageHeight: b.imageHeight,
        imageQuality: b.imageQuality,
        imageStyle: b.imageStyle,
        imageRatio: b.imageRatio,
        generatePDFs: b.generatePDFs,
        pdfRatio: b.pdfRatio,
        demoMode: b.demoMode,

        // credentials (flat)
        clientId: b.clientId,
        clientSecret: b.clientSecret,

        // data URLs (optional)
        customImageDataUrl,
        customImageName,
        customPdfDataUrl,
        customPdfName,
      };

      // Call your internal generator or Liferay here…
      // const out = await liferayService.generateProducts(payload);

      return res.json({
        success: true,
        message: 'Generation request accepted',
      });
    } catch (err) {
      logger.errorWithStack(err, {
        correlationId: req.correlationId,
        operation: 'generate-products',
      });
      return res.status(400).json({ success: false, error: err.message });
    }
  }
);

app.post(
  '/api/generate/orders',
  inputValidationMiddleware(generateOrdersSchema),
  async (req, res) => {
    try {
      const {
        liferayUrl,
        clientId,
        clientSecret,
        catalogId,
        channelId,
        currencyCode,
        localeCode,
        aiModel,
        selectedLanguages,
        orderCount,
        batchSize,
        demoMode,
        microserviceUrl,
        pollingDelay,
      } = req.body;

      if (demoMode) {
        return handleDemoOrderGeneration(req, res);
      }

      if (!channelId) {
        return res.status(400).json({
          success: false,
          error: 'channelId is required for order generation',
        });
      }

      if (!currencyCode) {
        return res.status(400).json({
          success: false,
          error: 'currencyCode is required for order generation',
        });
      }

      if (!aiModel) {
        return res.status(400).json({
          success: false,
          error: 'AI model is required',
        });
      }

      if (!batchSize) {
        return res.status(400).json({
          success: false,
          error: 'Batch size is required',
        });
      }

      const productValidation = await liferayService.validateProducts({
        liferayUrl,
        clientId,
        clientSecret,
        catalogId,
        requiredCount: 1,
      });

      if (!productValidation.sufficient) {
        throw new Error(
          `Not enough products available in catalog ${catalogId}. Required: ${productValidation.required}, Available: ${productValidation.count}. Please ensure products are created.`
        );
      }

      const accountValidation = await liferayService.validateAccounts({
        liferayUrl,
        clientId,
        clientSecret,
        requiredCount: 1,
      });

      if (!accountValidation.sufficient) {
        throw new Error(
          `Not enough accounts available. Required: ${accountValidation.required}, Available: ${accountValidation.count}. Please ensure accounts are created.`
        );
      }

      console.log(`Starting order generation: ${orderCount} orders`);

      const config = {
        liferayUrl,
        clientId,
        clientSecret,
        catalogId,
        channelId,
        currencyCode,
        localeCode,
        microserviceUrl: microserviceUrl || req.body.microserviceUrl,
        aiModel,
        selectedLanguages,
        demoMode,
        pollingDelay: pollingDelay,
      };

      const options = {
        count: orderCount,
        batchSize: batchSize,
        catalogId: config.catalogId,
        enableRetry: req.body.enableRetry,
      };

      const results = await orderGenerator.generateOrders(config, {
        count: orderCount,
        batchSize: batchSize,
      });

      // Emit progress update via WebSocket for PDF generation
      if (results.pdfProgress) {
        global.broadcastProgress({
          type: 'generation-progress',
          generator: 'order',
          subType: 'pdf',
          batchId: results.batchId,
          progress: results.pdfProgress.current / results.pdfProgress.total,
          current: results.pdfProgress.current,
          total: results.pdfProgress.total,
          timestamp: new Date().toISOString(),
        });
      }

      // Emit progress update via WebSocket for Image generation
      if (results.imageProgress) {
        global.broadcastProgress({
          type: 'generation-progress',
          generator: 'order',
          subType: 'image',
          batchId: results.batchId,
          progress: results.imageProgress.current / results.imageProgress.total,
          current: results.imageProgress.current,
          total: results.imageProgress.total,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        count: results.created,
        errors: results.errors,
        data: results.orders,
      });
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'generate-orders',
      });

      // Check for validation errors that should be warnings
      const errorMessage = error.message || 'Order generation failed';
      let statusCode = 500;

      if (
        errorMessage.includes('No products available') ||
        errorMessage.includes('No accounts available') ||
        errorMessage.includes('Not enough products available') ||
        errorMessage.includes('Not enough accounts available')
      ) {
        statusCode = 400;
      }

      if (errorMessage.includes('OpenAI API key not configured')) {
        errorMessage =
          'AI service error: OpenAI API key not configured. Please set it in the AI Configuration object.';
      }

      res.status(statusCode).json({
        success: false,
        error: `Order generation failed: ${errorMessage}`,
        details: error.stack,
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
