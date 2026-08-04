/**
 * authorizationMiddleware.test.cjs
 *
 * Tests requireAdmin, the authorization gate for destructive/config-changing
 * routes (/config/save, delete routes, MCP tool routes). This is distinct
 * from authGate.test.cjs, which covers *authentication* (is the caller who
 * they say they are); this covers *authorization* (is that caller allowed
 * to take this specific action).
 *
 * No live server or Liferay instance needed -- middleware tested in
 * isolation with mock req/res/next, consistent with authGate.test.cjs.
 */

const { requireAdmin } = require('../middleware/authorizationMiddleware.cjs');

function mockReq(overrides = {}) {
  return {
    method: 'POST',
    path: '/config/save',
    correlationId: 'test-cid',
    user: undefined,
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('requireAdmin', () => {
  const originalAllowlist = process.env.AICA_ADMIN_EMAILS;

  afterEach(() => {
    process.env.AICA_ADMIN_EMAILS = originalAllowlist;
  });

  it('rejects an unauthenticated request (no req.user) with 401', () => {
    process.env.AICA_ADMIN_EMAILS = 'admin@liferay.com';
    const req = mockReq({ user: undefined });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('denies all requests with 503 when AICA_ADMIN_EMAILS is not configured, even for an authenticated caller', () => {
    delete process.env.AICA_ADMIN_EMAILS;
    const req = mockReq({
      user: { claims: { email: 'someone@liferay.com', sub: '1' } },
    });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an authenticated caller whose email is not in the allowlist with 403', () => {
    process.env.AICA_ADMIN_EMAILS =
      'admin@liferay.com, other-admin@liferay.com';
    const req = mockReq({
      user: { claims: { email: 'not-an-admin@liferay.com', sub: '2' } },
    });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an authenticated caller whose email is in the allowlist', () => {
    process.env.AICA_ADMIN_EMAILS = 'admin@liferay.com';
    const req = mockReq({
      user: { claims: { email: 'admin@liferay.com', sub: '3' } },
    });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allowlist matching is case-insensitive', () => {
    process.env.AICA_ADMIN_EMAILS = 'Admin@Liferay.com';
    const req = mockReq({
      user: { claims: { email: 'admin@liferay.com', sub: '4' } },
    });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects an authenticated caller with no email claim, even with an allowlist configured', () => {
    process.env.AICA_ADMIN_EMAILS = 'admin@liferay.com';
    const req = mockReq({ user: { claims: { sub: '5' } } });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
