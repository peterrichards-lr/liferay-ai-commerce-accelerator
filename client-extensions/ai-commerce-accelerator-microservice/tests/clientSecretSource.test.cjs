const crypto = require('crypto');
const {
  requestSigningMiddleware,
} = require('../middleware/securityMiddleware.cjs');

/**
 * A signed request is only ever accepted against a secret something supplied.
 *
 * `getClientSecret` used to carry a built-in answer for the client id the tests
 * use, behind an override that was never declared in ENV and so could not
 * change it. Nothing in this codebase signs a request - the only producers are
 * two test files - so the built-in served no caller while remaining a credential
 * on the path `server.cjs` applies to the whole v1 API.
 *
 * These assert the shape rather than the value that was removed: with nothing
 * configured, no client id resolves and every signature is refused; when a
 * secret is supplied through the supported path, a correct signature is still
 * accepted and a wrong one still is not. A regression that reintroduced any
 * built-in answer, for any client id, fails the first two. See #1070.
 */
function mockReq({ cache, headers }) {
  return {
    get: vi.fn((h) => headers[h] ?? null),
    method: 'POST',
    path: '/api/v1/generate',
    body: { prompt: 'test' },
    correlationId: 'cid-secret',
    app: { locals: { ctx: cache ? { cache } : {} } },
  };
}

function sign({ clientId, secret, timestamp, req }) {
  const payload = `${req.method}${req.path}${timestamp}${JSON.stringify(req.body)}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function headersFor(clientId, signature, timestamp) {
  return {
    'X-Client-ID': clientId,
    'X-Request-Timestamp': timestamp,
    'X-Request-Signature': signature,
  };
}

describe('the client secret has no built-in source', () => {
  const timestamp = Date.now().toString();
  const body = { prompt: 'test' };
  const shape = { method: 'POST', path: '/api/v1/generate', body };

  let res, next;

  beforeEach(() => {
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    next = vi.fn();
  });

  it('refuses a signed request when nothing supplies a secret', () => {
    // No cache at all: there is no other place a secret could come from.
    const signature = sign({
      clientId: 'test-client',
      secret: 'whatever',
      timestamp,
      req: shape,
    });
    const req = mockReq({
      cache: null,
      headers: headersFor('test-client', signature, timestamp),
    });

    requestSigningMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('refuses when the supported source holds nothing for that client', () => {
    const cache = { getConfig: vi.fn(() => null), cacheConfig: vi.fn() };
    const signature = sign({
      clientId: 'any-client',
      secret: 'whatever',
      timestamp,
      req: shape,
    });
    const req = mockReq({
      cache,
      headers: headersFor('any-client', signature, timestamp),
    });

    requestSigningMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts a correct signature against a secret that was supplied', () => {
    const secret = 'supplied-by-the-deployment';
    const cache = { getConfig: vi.fn(() => secret), cacheConfig: vi.fn() };
    const signature = sign({
      clientId: 'real-client',
      secret,
      timestamp,
      req: shape,
    });
    const req = mockReq({
      cache,
      headers: headersFor('real-client', signature, timestamp),
    });

    requestSigningMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('still refuses a wrong signature against a supplied secret', () => {
    const cache = {
      getConfig: vi.fn(() => 'supplied-by-the-deployment'),
      cacheConfig: vi.fn(),
    };
    const signature = sign({
      clientId: 'real-client',
      secret: 'not-the-one',
      timestamp,
      req: shape,
    });
    const req = mockReq({
      cache,
      headers: headersFor('real-client', signature, timestamp),
    });

    requestSigningMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
