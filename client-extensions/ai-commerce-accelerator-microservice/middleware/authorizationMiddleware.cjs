const axios = require('axios');
const { logger } = require('../utils/logger.cjs');
const { liferayBaseUrl } = require('./loggingMiddleware.cjs');

// RoleConstants.ADMINISTRATOR: the portal's regular Administrator role, by its
// name rather than its title.
const ADMINISTRATOR_ROLE_NAME = 'Administrator';

// Short, so revoking the role takes effect within a minute, but long enough
// that a deletion flow's burst of admin calls costs one lookup, not one each.
const ROLE_CACHE_TTL_MS = 60 * 1000;
const ROLE_LOOKUP_TIMEOUT_MS = 10 * 1000;
const administratorRoleCache = new Map();

// The grant a client-credentials application uses. Liferay stamps it into the
// token, and it is the only claim that distinguishes a machine caller from the
// user that application is bound to.
const MACHINE_GRANT_TYPE = 'client_credentials';

// Both allowlists are comma-separated, trimmed and compared lowercase. An
// empty AICA_ADMIN_CLIENTS grants no machine anything; an empty AICA_ADMINS
// defers to the portal's Administrator role (#1388).
function allowlistFrom(...values) {
  return (values.find(Boolean) || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

// Interim authorization check for destructive/config-changing routes
// (overwriting the active Liferay connection config, deleting all commerce
// data, MCP teardown tools). userContextMiddleware/requestSigningMiddleware
// only verify a caller is *authenticated* (a valid Liferay JWT, a valid
// request signature, or loopback) -- nothing in this service previously
// checked whether that caller was actually *authorized* to take a
// destructive action, so any authenticated Liferay account could call these
// routes.
//
// An explicit AICA_ADMINS allowlist decides when it is set. Without one, a
// human caller is admitted if Liferay says they hold the Administrator role -
// see admitPortalAdministrator below.
function requireAdmin(req, res, next) {
  if (!req.user?.claims) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required for this action',
      timestamp: new Date().toISOString(),
    });
  }

  // A machine credential is refused whatever the allowlist says. A
  // client-credentials application is bound to a portal user and its token
  // carries that user's `sub` - bind one to an administrator and it is
  // indistinguishable from the administrator by identity alone. `grant_type` is
  // the only claim that marks how the token was obtained.
  //
  // Deny-listed, not allow-listed: a legitimate user's refresh-grant token
  // carries no `grant_type` claim at all, so admitting only known-human grants
  // would lock a real administrator out the moment their token refreshed. Both
  // shapes were measured against DXP 2026.q3.0 (#930).
  // A machine is admitted only by name, and only through its own control.
  //
  // A client-credentials application is bound to a portal user and presents
  // that user's `sub`, so it cannot be told from that user by identity alone.
  // AICA_ADMINS therefore never admits one: the caller must be named in
  // AICA_ADMIN_CLIENTS, which grants applications rather than people. Granting
  // a machine is then a deliberate act in its own variable, not a side effect
  // of whichever user an application happens to be bound to (#988).
  if (req.user.claims.grant_type === MACHINE_GRANT_TYPE) {
    const clients = allowlistFrom(process.env.AICA_ADMIN_CLIENTS);
    const clientId = String(req.user.claims.client_id || '')
      .trim()
      .toLowerCase();

    if (!clientId || !clients.includes(clientId)) {
      logger.warn('requireAdmin: rejected a machine credential', {
        correlationId: req.correlationId,
        operation: `${req.method} ${req.path}`,
        clientId: req.user.claims.client_id,
        userId: req.user.claims.sub,
      });

      return res.status(403).json({
        success: false,
        error:
          'This action requires an administrator account, or an application named in AICA_ADMIN_CLIENTS',
        timestamp: new Date().toISOString(),
      });
    }

    // Logged at warn, not info. A destructive action taken by no person is the
    // one an audit most needs to find, and nobody greps for info.
    logger.warn('requireAdmin: admitted a named machine credential', {
      correlationId: req.correlationId,
      operation: `${req.method} ${req.path}`,
      clientId: req.user.claims.client_id,
    });

    return next();
  }

  const allowlist = allowlistFrom(
    process.env.AICA_ADMINS,
    process.env.AICA_ADMIN_EMAILS
  );

  if (allowlist.length === 0) {
    return admitPortalAdministrator(req, res, next);
  }

  // Only `sub` is matched. Liferay issues no `email` claim to any caller -
  // measured against DXP 2026.q3.0 by decoding real tokens for the
  // authorization_code, password, refresh_token and client_credentials grants -
  // so the address form this allowlist used to accept could never match, and an
  // operator configuring one got a gate that failed closed with no explanation
  // (#930).
  //
  // `username` is not matched either, because it is not one thing: the same
  // user arrives as `test@liferay.com` on a password grant, `test` (screen name)
  // on client credentials, and `Test Test` (full name) on a refresh. Matching it
  // would admit a caller before their token refreshed and reject them after.
  const callerId = String(req.user.claims.sub || '')
    .trim()
    .toLowerCase();
  const isAllowed = Boolean(callerId) && allowlist.includes(callerId);

  if (!isAllowed) {
    // An address in the allowlist can never match, so say so rather than
    // leaving the operator to infer it from a 403 that looks like a policy
    // decision.
    const unusable = allowlist.filter((entry) => entry.includes('@'));

    if (unusable.length > 0) {
      logger.error(
        "requireAdmin: AICA_ADMINS contains email addresses, which can never match -- Liferay issues no email claim. Use the numeric Liferay user id (the token's `sub`)",
        {
          correlationId: req.correlationId,
          unusableEntries: unusable.length,
        }
      );
    }

    logger.warn('requireAdmin: rejected non-admin caller', {
      correlationId: req.correlationId,
      operation: `${req.method} ${req.path}`,
      userId: req.user.claims.sub,
    });
    return res.status(403).json({
      success: false,
      error: 'This action requires an administrator account',
      timestamp: new Date().toISOString(),
    });
  }

  next();
}

// With no AICA_ADMINS, the portal's own Administrator role decides. Every fresh
// install, quickstart and E2E stack has that role on its first user, and
// nothing in them sets AICA_ADMINS, so failing closed refused every
// destructive action on a stack nobody had configured yet (#1388). An explicit
// AICA_ADMINS still wins; this is only the unconfigured default.
//
// Read as the caller, with their own token, from the instance that verified
// it - so the answer is Liferay's, not ours, and no extra credential is held.
async function admitPortalAdministrator(req, res, next) {
  let isAdministrator;
  try {
    isAdministrator = await holdsAdministratorRole(req.user);
  } catch (error) {
    // Unknown, not "no": a Liferay that did not answer has not said the caller
    // lacks the role. Refusing is right; calling it a policy decision is not.
    logger.error("requireAdmin: could not read the caller's portal roles", {
      correlationId: req.correlationId,
      operation: `${req.method} ${req.path}`,
      userId: req.user.claims.sub,
      status: error?.response?.status,
      error: error?.message,
    });
    return res.status(503).json({
      success: false,
      error:
        "This action requires an administrator, and the caller's Liferay roles could not be read. Retry, or set AICA_ADMINS on the service.",
      timestamp: new Date().toISOString(),
    });
  }

  if (!isAdministrator) {
    logger.warn(
      'requireAdmin: rejected a caller without the Administrator role',
      {
        correlationId: req.correlationId,
        operation: `${req.method} ${req.path}`,
        userId: req.user.claims.sub,
      }
    );
    return res.status(403).json({
      success: false,
      error: 'This action requires an administrator account',
      timestamp: new Date().toISOString(),
    });
  }

  logger.info('requireAdmin: admitted a portal Administrator', {
    correlationId: req.correlationId,
    operation: `${req.method} ${req.path}`,
    userId: req.user.claims.sub,
  });
  return next();
}

// Matched on `key`, the role's name, because `name` is its title in the
// caller's locale (RoleBriefUtil) and would not say "Administrator" on a
// non-English portal. Top-level roleBriefs come from the user's UserBag, so a
// role held through a user group or organization counts too.
async function holdsAdministratorRole(user) {
  const cacheKey = `${user.liferayUrl}|${user.claims.sub}`;
  const cached = administratorRoleCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < ROLE_CACHE_TTL_MS) {
    return cached.isAdministrator;
  }

  const response = await axios.get(
    `${liferayBaseUrl(user.liferayUrl)}/o/headless-admin-user/v1.0/my-user-account`,
    {
      headers: { Authorization: `Bearer ${user.token}` },
      params: { fields: 'roleBriefs' },
      timeout: ROLE_LOOKUP_TIMEOUT_MS,
    }
  );

  const isAdministrator = (response.data?.roleBriefs || []).some(
    (role) => role?.key === ADMINISTRATOR_ROLE_NAME
  );
  administratorRoleCache.set(cacheKey, {
    isAdministrator,
    checkedAt: Date.now(),
  });
  return isAdministrator;
}

module.exports = { requireAdmin, administratorRoleCache };
