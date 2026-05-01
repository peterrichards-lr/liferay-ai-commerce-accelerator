const crypto = require('crypto');
const { logger } = require('../utils/logger.cjs');
const { CORRELATION_ID_HEADER } = require('../utils/sharedConstants.cjs');

function correlationIdMiddleware(req, res, next) {
  req.correlationId =
    req.get(CORRELATION_ID_HEADER) ||
    req.query.correlationId ||
    crypto.randomUUID();
  res.set(CORRELATION_ID_HEADER, req.correlationId);
  next();
}

function requestLoggingMiddleware(req, res, next) {
  const startTime = Date.now();

  const userAgent = req.get('User-Agent');
  const authHeader = req.get('Authorization');
  const sanitizedAuth = authHeader ? '[REDACTED]' : undefined;

  logger.trace('HTTP Request started', {
    correlationId: req.correlationId,
    operation: `${req.method} ${req.path}`,
    httpMethod: req.method,
    httpPath: req.path,
    httpUserAgent: userAgent,
    httpRemoteAddr: req.ip || req.connection.remoteAddress,
    httpAuthorization: sanitizedAuth,
  });

  const originalJson = res.json;
  res.json = function (data) {
    const duration = Date.now() - startTime;
    logger.httpRequest(req, res, duration);
    return originalJson.call(this, data);
  };

  next();
}

function errorLoggingMiddleware(error, req, res, next) {
  logger.errorWithStack(error, {
    correlationId: req.correlationId,
    operation: `${req.method} ${req.path}`,
    httpMethod: req.method,
    httpPath: req.path,
    httpUserAgent: req.get('User-Agent'),
    httpRemoteAddr: req.ip || req.connection.remoteAddress,
  });

  next(error);
}

function securityHeadersMiddleware(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  });
  next();
}

function userContextMiddleware(req, res, next) {
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    try {
      req.user = {
        token,
        claims: {
          sub: 'user-id-placeholder',
          email: 'user@example.com',
        },
      };
    } catch (error) {
      logger.warn('Invalid authorization token', {
        correlationId: req.correlationId,
        operation: 'token-validation',
        error: error.message,
      });
    }
  }

  next();
}

function basicRateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  const clients = new Map();

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, data] of clients.entries()) {
      data.requests = data.requests.filter((time) => time > cutoff);
      if (data.requests.length === 0) {
        clients.delete(key);
      }
    }
  }, windowMs);

  return (req, res, next) => {
    const clientKey = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;

    if (!clients.has(clientKey)) {
      clients.set(clientKey, { requests: [] });
    }

    const client = clients.get(clientKey);
    client.requests = client.requests.filter((time) => time > cutoff);

    if (client.requests.length >= maxRequests) {
      logger.warn('Rate limit exceeded', {
        correlationId: req.correlationId,
        clientKey,
        requestCount: client.requests.length,
        maxRequests,
        windowMs,
      });

      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((client.requests[0] + windowMs - now) / 1000),
        timestamp: new Date().toISOString(),
      });
    }

    client.requests.push(now);
    next();
  };
}

module.exports = {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  errorLoggingMiddleware,
  securityHeadersMiddleware,
  userContextMiddleware,
  basicRateLimitMiddleware,
};
