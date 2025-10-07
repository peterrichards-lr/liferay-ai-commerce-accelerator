const crypto = require('crypto');
const { logger } = require('../utils/logger.cjs');
const { cacheService } = require('../services/cacheService.cjs');

const { env } = require('../utils/constants.cjs');

// Input validation middleware
function inputValidationMiddleware(schema) {
  return (req, res, next) => {
    const errors = validateInput(req.body, schema);

    if (errors.length > 0) {
      logger.warn('Input validation failed', {
        correlationId: req.correlationId,
        operation: `${req.method} ${req.path}`,
        errors,
        userId: req.user?.claims?.sub,
      });

      return res.status(400).json({
        success: false,
        error: `Input validation failed: ${errors.join(', ')}`,
        details: errors,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

function validateInput(data, schema) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    // Required field check
    if (
      rules.required &&
      (value === undefined || value === null || value === '')
    ) {
      errors.push(`${field} is required`);
      continue;
    }

    // Skip further validation if field is not present and not required
    if (value === undefined || value === null) continue;

    // Type validations
    if (rules.type === 'string' && typeof value !== 'string') {
      errors.push(`${field} must be of type string`);
    } else if (rules.type === 'number' && typeof value !== 'number') {
      errors.push(`${field} must be of type number`);
    } else if (rules.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${field} must be of type boolean`);
    } else if (rules.type === 'array' && !Array.isArray(value)) {
      errors.push(`${field} must be of type array`);
    } else if (rules.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      errors.push(`${field} must be of type object`);
    }

    // String validations
    if (rules.type === 'string') {
      if (rules.minLength && value.length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength && value.length > rules.maxLength) {
        errors.push(`${field} must be at most ${rules.maxLength} characters`);
      }
      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push(`${field} format is invalid`);
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
      }
    }

    // Number validations
    if (rules.type === 'number') {
      if (rules.min && value < rules.min) {
        errors.push(`${field} must be at least ${rules.min}`);
      }
      if (rules.max && value > rules.max) {
        errors.push(`${field} must be at most ${rules.max}`);
      }
      if (rules.integer && !Number.isInteger(value)) {
        errors.push(`${field} must be an integer`);
      }
    }

    // Array validations
    if (rules.type === 'array' && Array.isArray(value)) {
      if (rules.minItems && value.length < rules.minItems) {
        errors.push(`${field} must have at least ${rules.minItems} items`);
      }
      if (rules.maxItems && value.length > rules.maxItems) {
        errors.push(`${field} must have at most ${rules.maxItems} items`);
      }
    }

    // Custom validation
    if (rules.custom && typeof rules.custom === 'function') {
      const customError = rules.custom(value, data);
      if (customError) {
        errors.push(`${field}: ${customError}`);
      }
    }
  }

  return errors;
}

// Request signing middleware for API authentication
function requestSigningMiddleware(req, res, next) {
  const signature = req.get('X-Request-Signature');
  const timestamp = req.get('X-Request-Timestamp');
  const clientId = req.get('X-Client-ID');

  // Skip if no signature headers
  if (!signature || !timestamp || !clientId) {
    return next();
  }

  const now = Date.now();
  const requestTime = parseInt(timestamp);

  // Check timestamp (5 minutes tolerance)
  if (Math.abs(now - requestTime) > 300000) {
    logger.warn('Request signature expired', {
      correlationId: req.correlationId,
      clientId,
      requestTime,
      currentTime: now,
      difference: Math.abs(now - requestTime),
    });

    return res.status(401).json({
      success: false,
      error: 'Request signature expired',
      timestamp: new Date().toISOString(),
    });
  }

  // Verify signature (would need client secret lookup)
  const isValid = verifyRequestSignature(req, signature, clientId);

  if (!isValid) {
    logger.warn('Invalid request signature', {
      correlationId: req.correlationId,
      clientId,
      signature: signature.substring(0, 8) + '...',
      path: req.path,
    });

    return res.status(401).json({
      success: false,
      error: 'Invalid request signature',
      timestamp: new Date().toISOString(),
    });
  }

  req.clientId = clientId;
  req.signedRequest = true;

  next();
}

function verifyRequestSignature(req, signature, clientId) {
  const clientSecret = getClientSecret(clientId);
  if (!clientSecret) return false;

  const timestamp = req.get('X-Request-Timestamp');
  const method = req.method;
  const path = req.path;
  const body = req.method !== 'GET' ? JSON.stringify(req.body) : '';

  const payload = `${method}${path}${timestamp}${body}`;
  const expectedSignature = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

function getClientSecret(clientId) {
  // Cache client secrets
  const cached = cacheService.getConfig(`client_secret:${clientId}`);
  if (cached) return cached;

  // In production, this would lookup from database or key store
  const secrets = {
    'test-client': env.TEST_CLIENT_SECRET || 'test-secret-key',
  };

  const secret = secrets[clientId];
  if (secret) {
    cacheService.cacheConfig(`client_secret:${clientId}`, secret, 3600000); // 1 hour
  }

  return secret;
}

// SQL injection prevention middleware
function sqlInjectionProtectionMiddleware(req, res, next) {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|TRUNCATE)\b)/i,
    /('|(\\x27)|(\\x22)|(\\x60)|(\\x3B)|(\\x2D)|(\\x2F)|(\\x5C))/i,
    /(\\x00|\\n|\\r|\\x1a)/i,
    /(\b(OR|AND)\b.*=)/i,
  ];

  const checkValue = (value, path = '') => {
    if (typeof value === 'string') {
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(value)) {
          logger.warn('Potential SQL injection detected', {
            correlationId: req.correlationId,
            path: req.path,
            field: path,
            pattern: pattern.toString(),
            value: value.substring(0, 100) + '...',
            userId: req.user?.claims?.sub,
          });
          return true;
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, val] of Object.entries(value)) {
        if (checkValue(val, `${path}.${key}`)) return true;
      }
    }
    return false;
  };

  // Check query parameters
  if (checkValue(req.query, 'query')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid input detected',
      timestamp: new Date().toISOString(),
    });
  }

  // Check body
  if (checkValue(req.body, 'body')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid input detected',
      timestamp: new Date().toISOString(),
    });
  }

  next();
}

// XSS protection middleware
function xssProtectionMiddleware(req, res, next) {
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
  ];

  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      for (const pattern of xssPatterns) {
        if (pattern.test(value)) {
          logger.warn('Potential XSS attack detected', {
            correlationId: req.correlationId,
            path: req.path,
            pattern: pattern.toString(),
            value: value.substring(0, 100) + '...',
            userId: req.user?.claims?.sub,
          });
          return value.replace(pattern, '');
        }
      }
      // Basic HTML entity encoding for critical characters
      return value
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }
    return value;
  };

  const sanitizeObject = (obj) => {
    if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          obj[key] = sanitizeValue(value);
        } else if (typeof value === 'object') {
          sanitizeObject(value);
        }
      }
    }
    return obj;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject({ ...req.body });
  }

  next();
}

// IP allowlist middleware
function ipAllowlistMiddleware(allowedIPs) {
  const allowed = new Set(allowedIPs);

  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const forwardedFor = req.get('X-Forwarded-For');
    const realIP = forwardedFor ? forwardedFor.split(',')[0].trim() : clientIP;

    // Allow localhost for development
    if (
      realIP === '127.0.0.1' ||
      realIP === '::1' ||
      realIP === '::ffff:127.0.0.1'
    ) {
      return next();
    }

    if (!allowed.has(realIP)) {
      logger.warn('IP not in allowlist', {
        correlationId: req.correlationId,
        clientIP: realIP,
        forwardedFor,
        path: req.path,
      });

      return res.status(403).json({
        success: false,
        error: 'Access denied',
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

// Request size limitation
function requestSizeLimitMiddleware(maxSize = 10485760) {
  // 10MB default
  return (req, res, next) => {
    const contentLength = parseInt(req.get('Content-Length') || '0');

    if (contentLength > maxSize) {
      logger.warn('Request size exceeds limit', {
        correlationId: req.correlationId,
        contentLength,
        maxSize,
        path: req.path,
      });

      return res.status(413).json({
        success: false,
        error: 'Request entity too large',
        maxSize,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

module.exports = {
  inputValidationMiddleware,
  requestSigningMiddleware,
  sqlInjectionProtectionMiddleware,
  xssProtectionMiddleware,
  ipAllowlistMiddleware,
  requestSizeLimitMiddleware,
  validateInput,
};