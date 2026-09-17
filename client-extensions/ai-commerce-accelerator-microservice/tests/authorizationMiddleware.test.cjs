/**
 * authorizationMiddleware.test.cjs
 *
 * Tests requireAdmin, the authorization gate for destructive/config-changing
 * routes (/config/save, delete routes, MCP tool routes). This is distinct
 * from authGate.test.cjs, which covers *authentication* (is the caller who
 * they say they are); this covers *authorization* (is that caller allowed
 * to take this specific action).
 *
 * The claim shapes below are the ones Liferay actually issues. They were
 * measured against DXP 2026.q3.0 by minting real tokens and decoding them, and
 * they are not what this file used to assume (#930):
 *
 *   authorization_code : { sub, username: 'test@liferay.com', grant_type: 'authorization_code', client_id, scope }
 *   password           : { sub, username: 'test@liferay.com', grant_type: 'password', client_id, scope }
 *   refresh_token      : { sub, username: 'Test Test', client_id, scope }          <- no grant_type
 *   client_credentials : { sub, username: 'test', grant_type: 'client_credentials', client_id }
 *
 * Three things follow, and each is covered below:
 *   - There is no `email` claim on any of them, so an address in the allowlist
 *     can never match.
 *   - `sub` is the same for a user and for a client-credentials application
 *     bound to that user, so identity alone cannot tell them apart.
 *   - A refresh-grant token carries no `grant_type`, so machine callers must be
 *     deny-listed rather than human grants allow-listed.
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

// A real user's token, by the grant that issued it.
const humanClaims = (sub, grant = 'password') => ({
  sub,
  username: 'test@liferay.com',
  client_id: 'FragmentRenderer',
  scope: 'liferay-json-web-services.everything.write',
  ...(grant ? { grant_type: grant } : {}),
});

// A client-credentials application bound to the portal user `sub`.
const machineClaims = (sub) => ({
  sub,
  username: 'test',
  client_id: 'id-36b22067-ebf1-1766-4aca-19a37d328017',
  grant_type: 'client_credentials',
});

describe('requireAdmin', () => {
  const originalAdmins = process.env.AICA_ADMINS;
  const originalAllowlist = process.env.AICA_ADMIN_EMAILS;

  afterEach(() => {
    // Both, not just one: several tests set AICA_ADMINS, and restoring only
    // AICA_ADMIN_EMAILS left it leaking into whatever ran next.
    for (const [key, value] of [
      ['AICA_ADMINS', originalAdmins],
      ['AICA_ADMIN_EMAILS', originalAllowlist],
    ]) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('rejects an unauthenticated request (no req.user) with 401', () => {
    process.env.AICA_ADMINS = '20132';
    const req = mockReq({ user: undefined });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('denies with 503 when no allowlist is configured, even for an authenticated caller', () => {
    delete process.env.AICA_ADMINS;
    delete process.env.AICA_ADMIN_EMAILS;
    const req = mockReq({ user: { claims: humanClaims('20132') } });
    const res = mockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  describe('machine credentials', () => {
    // The decisive case. A client-credentials application is bound to a portal
    // user, so its token carries that user's `sub`. Bind one to an
    // administrator and identity alone cannot tell it from the administrator.
    it('rejects a client-credentials token even when its sub is allowlisted', () => {
      process.env.AICA_ADMINS = '20132';
      const req = mockReq({ user: { claims: machineClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not a machine credential'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    // Deny-list, not allow-list. A refresh-grant token from a real user carries
    // no `grant_type` at all, so admitting only known-human grants would lock a
    // genuine administrator out as soon as their token refreshed.
    it('admits a refreshed human token, which carries no grant_type', () => {
      process.env.AICA_ADMINS = '20132';
      const req = mockReq({ user: { claims: humanClaims('20132', null) } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('admits the authorization_code and password grants', () => {
      process.env.AICA_ADMINS = '20132';

      for (const grant of ['authorization_code', 'password']) {
        const req = mockReq({ user: { claims: humanClaims('20132', grant) } });
        const res = mockRes();
        const next = vi.fn();

        requireAdmin(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      }
    });
  });

  describe('allowlist matching', () => {
    it('admits a caller whose user id is allowlisted', () => {
      process.env.AICA_ADMINS = '20132';
      const req = mockReq({ user: { claims: humanClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects a caller whose user id is not allowlisted', () => {
      process.env.AICA_ADMINS = '20132, 20399';
      const req = mockReq({ user: { claims: humanClaims('99999') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    // Liferay issues no `email` claim on any grant, so an address in the
    // allowlist matches nothing. This used to be the documented form.
    it('never matches an email address, because no token carries one', () => {
      process.env.AICA_ADMINS = 'test@liferay.com';
      const req = mockReq({ user: { claims: humanClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    // Both sides are normalised, so the fixture differs in case on both: an
    // allowlist entry that is already lowercase would not notice the caller
    // side being dropped.
    it('matching is case-insensitive and tolerates surrounding space', () => {
      process.env.AICA_ADMINS = '  ADMIN-42  ';
      const req = mockReq({ user: { claims: humanClaims('Admin-42') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('falls back to AICA_ADMIN_EMAILS when AICA_ADMINS is unset', () => {
      delete process.env.AICA_ADMINS;
      process.env.AICA_ADMIN_EMAILS = '20132';
      const req = mockReq({ user: { claims: humanClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects a token with no sub', () => {
      process.env.AICA_ADMINS = '20132';
      const req = mockReq({ user: { claims: { username: 'test' } } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
