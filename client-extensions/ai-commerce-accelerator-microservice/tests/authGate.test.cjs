/**
 * authGate.test.cjs
 *
 * Contract / auth-gate tests for the requestSigningMiddleware.
 *
 * These tests verify that the security middleware correctly:
 * 1. Rejects unsigned requests from non-localhost IPs with 401
 * 2. Allows unsigned requests from localhost loopback IPs (CLI / probe bypass)
 * 3. Allows JWT-authenticated requests without signing headers
 * 4. Rejects requests with tampered / expired signatures
 * 5. Allows health probe endpoints without signing (liveness/readiness)
 *
 * No live server or Liferay instance is needed — middleware is tested in isolation
 * using mock req/res/next objects, consistent with the existing security.test.cjs pattern.
 */

const crypto = require('crypto');
const {
  requestSigningMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const { logger } = require('../utils/logger.cjs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSignedHeaders(body = {}, secret = 'test-secret') {
  const clientId = 'test-client';
  const timestamp = Date.now().toString();
  const payloadString = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${clientId}:${timestamp}:${payloadString}`)
    .digest('hex');
  return {
    'X-Client-ID': clientId,
    'X-Request-Timestamp': timestamp,
    'X-Request-Signature': signature,
  };
}

function mockReq(overrides = {}) {
  return {
    path: '/generate',
    method: 'POST',
    body: { test: true },
    query: {},
    correlationId: 'test-cid',
    ip: '203.0.113.1', // Public (non-localhost) IP by default
    connection: {},
    socket: {},
    get: vi.fn((header) => overrides.headers?.[header] ?? null),
    user: overrides.user ?? null,
    ...overrides,
  };
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Auth Gate — requestSigningMiddleware', () => {
  let next;
  let originalWarn;

  beforeAll(() => {
    // Suppress logger output during tests
    originalWarn = logger.warn;
    logger.warn = vi.fn();
  });

  afterAll(() => {
    logger.warn = originalWarn;
  });

  beforeEach(() => {
    next = vi.fn();
  });

  // ── 1. Unsigned public-IP requests must be rejected ─────────────────────────

  describe('unsigned requests from non-localhost IPs', () => {
    it('should reject a request with no signing headers with 401', () => {
      const req = mockReq(); // No signing headers
      const res = mockRes();

      requestSigningMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Missing') })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject a request with only partial signing headers (missing signature)', () => {
      const req = mockReq({
        headers: {
          'X-Client-ID': 'test-client',
          'X-Request-Timestamp': Date.now().toString(),
          // Deliberately omitting X-Request-Signature
        },
      });
      const res = mockRes();

      requestSigningMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject a request with an invalid (tampered) signature', () => {
      const req = mockReq({
        headers: {
          'X-Client-ID': 'test-client',
          'X-Request-Timestamp': Date.now().toString(),
          'X-Request-Signature': 'deadbeefdeadbeef', // tampered
        },
      });
      const res = mockRes();

      requestSigningMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject a request with an expired timestamp (> 5 minutes old)', () => {
      const clientId = 'test-client';
      const expiredTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 minutes ago
      const signature = crypto
        .createHmac('sha256', 'any-secret')
        .update(
          `${clientId}:${expiredTimestamp}:${JSON.stringify({ test: true })}`
        )
        .digest('hex');

      const req = mockReq({
        headers: {
          'X-Client-ID': clientId,
          'X-Request-Timestamp': expiredTimestamp,
          'X-Request-Signature': signature,
        },
      });
      const res = mockRes();

      requestSigningMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── 2. Localhost loopback bypass ─────────────────────────────────────────────

  describe('localhost loopback bypass (CLI / probe traffic)', () => {
    const loopbackIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

    loopbackIPs.forEach((ip) => {
      it(`should allow unsigned requests from ${ip} without signing headers`, () => {
        const req = mockReq({ ip }); // No signing headers, loopback IP
        const res = mockRes();

        requestSigningMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(401);
      });
    });
  });

  // ── 3. JWT-authenticated requests bypass signing ──────────────────────────────

  describe('JWT-authenticated request bypass', () => {
    it('should allow a JWT-authenticated request (req.user set) without signing headers', () => {
      const req = mockReq({
        user: { claims: { sub: 'user-123' }, token: 'some.jwt.token' },
        // No signing headers, public IP
      });
      const res = mockRes();

      requestSigningMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(401);
    });
  });

  // ── 4. Health probe endpoints bypass signing ──────────────────────────────────

  describe('health probe endpoint bypass', () => {
    const probeEndpoints = [
      '/health',
      '/health/ready',
      '/health/live',
      '/health/detailed',
    ];

    probeEndpoints.forEach((probePath) => {
      it(`should allow unsigned probe requests to ${probePath}`, () => {
        const req = mockReq({ path: probePath }); // Public IP, no signing headers
        const res = mockRes();

        requestSigningMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(401);
      });
    });

    it('should NOT bypass signing for /health/shutdown (requires auth)', () => {
      const req = mockReq({ path: '/health/shutdown' }); // No signing headers
      const res = mockRes();

      requestSigningMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
