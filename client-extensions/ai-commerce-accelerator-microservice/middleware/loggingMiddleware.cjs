const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const axios = require('axios');
const { logger } = require('../utils/logger.cjs');
const { CORRELATION_ID_HEADER } = require('../utils/sharedConstants.cjs');

let cachedJwks = null;

async function fetchLiferayJwks(liferayUrl) {
  if (cachedJwks) return cachedJwks;
  const baseUrl = liferayUrl.startsWith('http')
    ? liferayUrl
    : `http://${liferayUrl}`;
  const response = await axios.get(`${baseUrl}/o/oauth2/jwks`);
  cachedJwks = response.data;
  return cachedJwks;
}

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

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('HTTP Request finished', {
      correlationId: req.correlationId,
      operation: `${req.method} ${req.path}`,
      httpStatus: res.statusCode,
      durationMs: duration,
    });
  });

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
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.substring(7);
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) {
    return res.status(401).json({ error: 'Malformed authorization token' });
  }

  const { kid } = decoded.header;
  const liferayUrl =
    req.config?.liferayUrl ||
    process.env.LIFERAY_URL ||
    'http://localhost:8080';

  fetchLiferayJwks(liferayUrl)
    .then((jwks) => {
      const key = jwks.keys.find((k) => k.kid === kid);
      if (!key) throw new Error('Key ID not found in JWKS');
      const pem = jwkToPem(key);

      jwt.verify(
        token,
        pem,
        { algorithms: ['RS256'] },
        (err, verifiedClaims) => {
          if (err) {
            return res
              .status(401)
              .json({ error: `Invalid JWT: ${err.message}` });
          }
          req.user = { token, claims: verifiedClaims };
          next();
        }
      );
    })
    .catch((err) => {
      logger.error('JWT Verification Failed', { error: err.message });
      res.status(500).json({ error: 'Internal identity verification failure' });
    });
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
