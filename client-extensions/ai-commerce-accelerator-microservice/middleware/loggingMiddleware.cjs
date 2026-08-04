const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const axios = require('axios');
const { logger } = require('../utils/logger.cjs');
const { CORRELATION_ID_HEADER } = require('../utils/sharedConstants.cjs');

const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let jwksCache = { data: null, fetchedAt: 0 };

async function fetchLiferayJwks(liferayUrl, forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    jwksCache.data &&
    now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS
  ) {
    return jwksCache.data;
  }
  const baseUrl = liferayUrl.startsWith('http')
    ? liferayUrl
    : `http://${liferayUrl}`;
  const response = await axios.get(`${baseUrl}/o/oauth2/jwks`);
  jwksCache = { data: response.data, fetchedAt: Date.now() };
  return jwksCache.data;
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

// Shared JWT verification, used by both the HTTP middleware below and the
// WebSocket upgrade handshake (services/webSocketService.cjs) -- neither one
// should re-implement or diverge from this logic. Returns verified claims,
// or throws with a `.status` hint (401 for bad/invalid tokens, 500 for
// infrastructure failures fetching the JWKS) for the caller to translate.
async function verifyBearerToken(token, liferayUrl) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) {
    const err = new Error('Malformed authorization token');
    err.status = 401;
    throw err;
  }

  const { kid } = decoded.header;
  const verifyWithJwks = (jwks) => {
    const key = jwks.keys.find((k) => k.kid === kid);
    return key ? key : null;
  };

  let key;
  try {
    const jwks = await fetchLiferayJwks(liferayUrl);
    key = verifyWithJwks(jwks);
    if (!key) {
      logger.info(
        'kid not found in JWKS cache, forcing refresh for key rotation',
        { kid }
      );
      const refreshed = await fetchLiferayJwks(liferayUrl, true);
      key = verifyWithJwks(refreshed);
    }
  } catch (err) {
    logger.error('JWT Verification Failed', { error: err.message });
    const wrapped = new Error('Internal identity verification failure');
    wrapped.status = 500;
    throw wrapped;
  }
  if (!key) {
    const err = new Error('Key ID not found in JWKS after refresh');
    err.status = 401;
    throw err;
  }

  const pem = jwkToPem(key);
  return new Promise((resolve, reject) => {
    jwt.verify(token, pem, { algorithms: ['RS256'] }, (err, verifiedClaims) => {
      if (err) {
        const wrapped = new Error(`Invalid JWT: ${err.message}`);
        wrapped.status = 401;
        return reject(wrapped);
      }
      resolve(verifiedClaims);
    });
  });
}

function resolveLiferayUrl(req) {
  return (
    req?.config?.liferayUrl ||
    process.env.LIFERAY_URL ||
    'http://localhost:8080'
  );
}

function userContextMiddleware(req, res, next) {
  const authHeader = req.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.substring(7);
  verifyBearerToken(token, resolveLiferayUrl(req))
    .then((verifiedClaims) => {
      req.user = { token, claims: verifiedClaims };
      next();
    })
    .catch((err) => {
      res.status(err.status || 500).json({ error: err.message });
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
  verifyBearerToken,
  resolveLiferayUrl,
};
