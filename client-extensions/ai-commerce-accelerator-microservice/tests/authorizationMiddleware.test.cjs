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

const axios = require('axios');
const {
  requireAdmin,
  administratorRoleCache,
} = require('../middleware/authorizationMiddleware.cjs');

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
  const originalClients = process.env.AICA_ADMIN_CLIENTS;

  afterEach(() => {
    // Both, not just one: several tests set AICA_ADMINS, and restoring only
    // AICA_ADMIN_EMAILS left it leaking into whatever ran next.
    for (const [key, value] of [
      ['AICA_ADMINS', originalAdmins],
      ['AICA_ADMIN_EMAILS', originalAllowlist],
      ['AICA_ADMIN_CLIENTS', originalClients],
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

  // With no AICA_ADMINS, Liferay's Administrator role decides (#1388). The
  // shapes are my-user-account's: `key` is the role's name, `name` its title
  // in the caller's locale (RoleBriefUtil).
  describe('no AICA_ADMINS: the portal Administrator role decides', () => {
    const LIFERAY = 'https://aica.demo';
    let realGet;
    let httpGet;

    const userOf = (sub) => ({
      token: 'user-token',
      claims: humanClaims(sub),
      liferayUrl: LIFERAY,
    });
    const roles = (...keys) => ({
      data: {
        roleBriefs: keys.map((key) => ({ key, name: `title of ${key}` })),
      },
    });

    beforeEach(() => {
      delete process.env.AICA_ADMINS;
      delete process.env.AICA_ADMIN_EMAILS;
      administratorRoleCache.clear();
      realGet = axios.get;
      httpGet = vi.fn();
      axios.get = httpGet;
    });

    afterEach(() => {
      axios.get = realGet;
    });

    it('admits a caller holding the Administrator role, asked as that caller', async () => {
      httpGet.mockResolvedValue(roles('User', 'Administrator'));
      const res = mockRes();
      const next = vi.fn();

      await requireAdmin(mockReq({ user: userOf('20132') }), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(httpGet).toHaveBeenCalledWith(
        `${LIFERAY}/o/headless-admin-user/v1.0/my-user-account`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer user-token' },
          params: { fields: 'roleBriefs' },
        })
      );
    });

    it('matches the role name, not its localised title', async () => {
      httpGet.mockResolvedValue({
        data: { roleBriefs: [{ key: 'Power User', name: 'Administrator' }] },
      });
      const res = mockRes();
      const next = vi.fn();

      await requireAdmin(mockReq({ user: userOf('20132') }), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a caller without the role with 403', async () => {
      httpGet.mockResolvedValue(roles('User', 'Power User'));
      const res = mockRes();
      const next = vi.fn();

      await requireAdmin(mockReq({ user: userOf('20456') }), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('fails closed with 503 when the roles cannot be read: unknown is not "no"', async () => {
      httpGet.mockRejectedValue(
        Object.assign(new Error('timeout'), { response: { status: 504 } })
      );
      const res = mockRes();
      const next = vi.fn();

      await requireAdmin(mockReq({ user: userOf('20132') }), res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('fails closed with 503 when the verifying instance is not known', async () => {
      const res = mockRes();
      const next = vi.fn();

      await requireAdmin(
        mockReq({ user: { claims: humanClaims('20132') } }),
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(httpGet).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('does not cache a failed lookup', async () => {
      httpGet.mockRejectedValueOnce(new Error('ECONNRESET'));
      httpGet.mockResolvedValueOnce(roles('Administrator'));
      const next = vi.fn();

      await requireAdmin(mockReq({ user: userOf('20132') }), mockRes(), next);
      await requireAdmin(mockReq({ user: userOf('20132') }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(httpGet).toHaveBeenCalledTimes(2);
    });

    it('asks once per caller and instance within the cache window', async () => {
      httpGet.mockResolvedValue(roles('Administrator'));
      const next = vi.fn();

      await requireAdmin(mockReq({ user: userOf('20132') }), mockRes(), next);
      await requireAdmin(mockReq({ user: userOf('20132') }), mockRes(), next);
      await requireAdmin(
        mockReq({ user: { ...userOf('20132'), liferayUrl: 'https://other' } }),
        mockRes(),
        next
      );

      expect(next).toHaveBeenCalledTimes(3);
      expect(httpGet).toHaveBeenCalledTimes(2);
    });

    it('never admits a machine by role, even one bound to an Administrator', async () => {
      httpGet.mockResolvedValue(roles('Administrator'));
      const res = mockRes();
      const next = vi.fn();

      await requireAdmin(
        mockReq({
          user: { ...userOf('20132'), claims: machineClaims('20132') },
        }),
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(httpGet).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('is not consulted when AICA_ADMINS is set', async () => {
      process.env.AICA_ADMINS = '99999';
      httpGet.mockResolvedValue(roles('Administrator'));
      const res = mockRes();
      const next = vi.fn();

      await requireAdmin(mockReq({ user: userOf('20132') }), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(httpGet).not.toHaveBeenCalled();
    });
  });

  describe('machine credentials', () => {
    // The decisive case. A client-credentials application is bound to a portal
    // user, so its token carries that user's `sub`. Bind one to an
    // administrator and identity alone cannot tell it from the administrator.
    it('rejects a client-credentials token even when its sub is allowlisted', () => {
      process.env.AICA_ADMINS = '20132';
      delete process.env.AICA_ADMIN_CLIENTS;
      const req = mockReq({ user: { claims: machineClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('AICA_ADMIN_CLIENTS'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    // The machine allowlist is a separate grant, so a named application is
    // admitted without ever appearing in AICA_ADMINS (#988).
    it('admits a machine whose client_id is named in AICA_ADMIN_CLIENTS', () => {
      process.env.AICA_ADMINS = '';
      process.env.AICA_ADMIN_CLIENTS =
        'id-36b22067-ebf1-1766-4aca-19a37d328017';
      const req = mockReq({ user: { claims: machineClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects a machine whose client_id is not named', () => {
      process.env.AICA_ADMIN_CLIENTS = 'id-some-other-application';
      const req = mockReq({ user: { claims: machineClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('fails closed when AICA_ADMIN_CLIENTS is unset', () => {
      process.env.AICA_ADMINS = '20132';
      delete process.env.AICA_ADMIN_CLIENTS;
      const req = mockReq({ user: { claims: machineClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    // The two controls must not blur. Putting a client id in the human list
    // must grant nothing: if AICA_ADMINS could name an application, a machine
    // would be back to entering through the operator allowlist, which is the
    // hole #987 closed.
    it('does not admit a machine named in AICA_ADMINS rather than AICA_ADMIN_CLIENTS', () => {
      process.env.AICA_ADMINS = 'id-36b22067-ebf1-1766-4aca-19a37d328017';
      delete process.env.AICA_ADMIN_CLIENTS;
      const req = mockReq({ user: { claims: machineClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    // The boundary in the other direction: naming an application must not let a
    // human in through it. The two lists grant different things.
    it('does not admit a human because their client_id is a named application', async () => {
      process.env.AICA_ADMINS = '';
      process.env.AICA_ADMIN_CLIENTS = 'FragmentRenderer';
      const req = mockReq({ user: { claims: humanClaims('20132') } });
      const res = mockRes();
      const next = vi.fn();

      // Falls through to the role check, which cannot run without the
      // verifying instance - so refused, and not by AICA_ADMIN_CLIENTS.
      await requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
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
