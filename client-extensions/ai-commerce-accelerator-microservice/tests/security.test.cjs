const {
  sqlInjectionProtectionMiddleware,
  inputValidationMiddleware,
  requestSigningMiddleware,
  requestSizeLimitMiddleware,
  xssProtectionMiddleware,
  validateInput,
} = require('../middleware/securityMiddleware.cjs');
const { logger } = require('../utils/logger.cjs');
const crypto = require('crypto');

describe('Security Middleware - SQL Injection', () => {
  let req;
  let res;
  let next;
  let originalWarn;

  beforeAll(() => {
    originalWarn = logger.warn;
    logger.warn = vi.fn();
  });

  afterAll(() => {
    logger.warn = originalWarn;
  });

  beforeEach(() => {
    req = {
      path: '/api/v1/batch/callback',
      query: {},
      body: {},
      correlationId: 'test-cid',
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it('should allow legitimate batch operation codes in callback path', () => {
    const operations = [
      'create',
      'update',
      'delete',
      'upsert',
      'CREATE',
      'UPDATE',
    ];

    operations.forEach((op) => {
      req.query.opCode = op;
      sqlInjectionProtectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(400);
      next.mockClear();
    });
  });

  it('should still block actual SQL keywords in other fields', () => {
    req.query.otherField = 'SELECT * FROM users';
    sqlInjectionProtectionMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('should block SQL keywords in opCode if path is not callback', () => {
    req.path = '/api/v1/other-endpoint';
    req.query.opCode = 'CREATE';

    sqlInjectionProtectionMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('Security Middleware - Input Validation', () => {
  it('should pass valid input', () => {
    const schema = {
      name: { type: 'string', required: true, minLength: 3 },
      age: { type: 'number', min: 18 },
    };
    const data = { name: 'John', age: 25 };
    const errors = validateInput(data, schema);
    expect(errors).toHaveLength(0);
  });

  it('should detect missing required fields', () => {
    const schema = { name: { type: 'string', required: true } };
    const data = {};
    const errors = validateInput(data, schema);
    expect(errors).toContain('name is required');
  });

  it('should detect invalid types', () => {
    const schema = { age: { type: 'number' } };
    const data = { age: '25' };
    const errors = validateInput(data, schema);
    expect(errors).toContain('age must be of type number');
  });

  it('should detect out-of-bounds values', () => {
    const schema = {
      name: { type: 'string', maxLength: 3 },
      age: { type: 'number', max: 20 },
    };
    const data = { name: 'John', age: 25 };
    const errors = validateInput(data, schema);
    expect(errors).toContain('name must be at most 3 characters');
    expect(errors).toContain('age must be at most 20');
  });

  it('should use inputValidationMiddleware correctly', () => {
    const req = {
      body: { age: 'not_a_number' },
      method: 'POST',
      path: '/test',
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const middleware = inputValidationMiddleware({ age: { type: 'number' } });

    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('Security Middleware - Request Signing', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      get: vi.fn(),
      method: 'POST',
      path: '/api/v1/generate',
      body: { prompt: 'test' },
      correlationId: 'cid-123',
      app: {
        locals: {
          ctx: {
            cache: {
              getConfig: vi.fn().mockReturnValue('my-secret-key'),
              cacheConfig: vi.fn(),
            },
          },
        },
      },
    };
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    next = vi.fn();
  });

  it('should reject requests if headers are missing and path is not a health check', () => {
    req.get.mockReturnValue(null);
    requestSigningMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Missing required request-signing headers',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should skip validation if headers are missing but path is a health check endpoint', () => {
    req.get.mockReturnValue(null);
    req.path = '/api/v1/health/ready';
    requestSigningMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject expired timestamps', () => {
    req.get.mockImplementation((header) => {
      if (header === 'X-Request-Signature') return 'abc';
      if (header === 'X-Request-Timestamp')
        return (Date.now() - 400000).toString();
      if (header === 'X-Client-ID') return 'test-client';
    });

    requestSigningMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Request signature expired' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should accept valid signatures', () => {
    const timestamp = Date.now().toString();
    const payload = `POST/api/v1/generate${timestamp}{"prompt":"test"}`;
    const signature = crypto
      .createHmac('sha256', 'my-secret-key')
      .update(payload)
      .digest('hex');

    req.get.mockImplementation((header) => {
      if (header === 'X-Request-Signature') return signature;
      if (header === 'X-Request-Timestamp') return timestamp;
      if (header === 'X-Client-ID') return 'test-client';
    });

    requestSigningMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.signedRequest).toBe(true);
  });

  it('should reject invalid signatures', () => {
    const timestamp = Date.now().toString();
    const invalidSignature = '0'.repeat(64);

    req.get.mockImplementation((header) => {
      if (header === 'X-Request-Signature') return invalidSignature;
      if (header === 'X-Request-Timestamp') return timestamp;
      if (header === 'X-Client-ID') return 'test-client';
    });

    requestSigningMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid request signature' })
    );
  });
});

describe('Security Middleware - XSS Protection', () => {
  let req, res, next;

  beforeEach(() => {
    req = { body: {}, correlationId: 'cid' };
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    next = vi.fn();
  });

  it('should strip script tags from nested objects', () => {
    req.body = {
      description: 'Hello <script>alert(1)</script> World',
      nested: {
        field: '<iframe src="javascript:alert(1)"></iframe>',
      },
    };

    xssProtectionMiddleware(req, res, next);
    expect(req.body.description).toBe('Hello  World');
    expect(req.body.nested.field).toBe('');
    expect(next).toHaveBeenCalled();
  });

  it('should encode HTML entities', () => {
    req.body = { text: '<p>Some "quoted" text & \'single\'</p>' };
    xssProtectionMiddleware(req, res, next);
    expect(req.body.text).toBe(
      '&lt;p&gt;Some &quot;quoted&quot; text & &#x27;single&#x27;&lt;/p&gt;'
    );
  });
});

/**
 * The general ceiling guards every route; the import needs its own, because a
 * dataset package is the one payload this service legitimately receives at
 * size. A 22-product .aicap with its images and PDFs is 30MB, and the general
 * 10MB ceiling rejected a package this same service had just produced (#887).
 */
describe('Security Middleware - request size ceilings (#887)', () => {
  const IMPORT_PATH = '/import-commerce-data';

  const request = (path, contentLength) => ({
    get: (header) =>
      header === 'Content-Length' ? String(contentLength) : undefined,
    path,
  });

  const response = () => {
    const res = { statusCode: null, body: null };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.body = body;
      return res;
    };
    return res;
  };

  let originalWarn;

  beforeAll(() => {
    originalWarn = logger.warn;
    logger.warn = vi.fn();
  });

  afterAll(() => {
    logger.warn = originalWarn;
  });

  it('rejects an oversized request on an ordinary route', () => {
    const middleware = requestSizeLimitMiddleware(10 * 1024 * 1024);
    const res = response();
    const next = vi.fn();

    middleware(request('/generate', 30 * 1024 * 1024), res, next);

    expect(res.statusCode).toBe(413);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a 30MB package through on the route that has its own ceiling', () => {
    const middleware = requestSizeLimitMiddleware(10 * 1024 * 1024, {
      overrides: { [IMPORT_PATH]: 256 * 1024 * 1024 },
    });
    const res = response();
    const next = vi.fn();

    middleware(request(IMPORT_PATH, 30 * 1024 * 1024), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('still bounds the overridden route rather than letting anything through', () => {
    const middleware = requestSizeLimitMiddleware(10 * 1024 * 1024, {
      overrides: { [IMPORT_PATH]: 256 * 1024 * 1024 },
    });
    const res = response();
    const next = vi.fn();

    middleware(request(IMPORT_PATH, 300 * 1024 * 1024), res, next);

    expect(res.statusCode).toBe(413);
    expect(res.body.maxSize).toBe(256 * 1024 * 1024);
  });

  it('does not widen a route the override does not name', () => {
    const middleware = requestSizeLimitMiddleware(10 * 1024 * 1024, {
      overrides: { [IMPORT_PATH]: 256 * 1024 * 1024 },
    });
    const res = response();
    const next = vi.fn();

    middleware(
      request('/import-commerce-data-other', 30 * 1024 * 1024),
      res,
      next
    );

    expect(res.statusCode).toBe(413);
    expect(res.body.maxSize).toBe(10 * 1024 * 1024);
  });
});
