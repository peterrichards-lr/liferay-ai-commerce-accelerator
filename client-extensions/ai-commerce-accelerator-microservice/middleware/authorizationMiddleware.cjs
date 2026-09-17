const { logger } = require('../utils/logger.cjs');

// The grant a client-credentials application uses. Liferay stamps it into the
// token, and it is the only claim that distinguishes a machine caller from the
// user that application is bound to.
const MACHINE_GRANT_TYPE = 'client_credentials';

// Both allowlists are comma-separated, trimmed and compared lowercase. Empty
// means empty: neither grants anything by default, so an unconfigured service
// refuses every destructive call rather than guessing.
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
// This is deliberately a narrow, verifiable allowlist rather than a full
// Liferay role/permission integration: this codebase has no existing
// pattern for reading role claims from the verified JWT (grep confirms
// `req.user.claims` is set but never read anywhere in routes/), and getting
// a from-scratch Liferay role-API integration subtly wrong would be worse
// than not attempting one without a live instance to verify against. Track
// upgrading this to a real Liferay role check as a follow-up.
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
    logger.error(
      'requireAdmin: AICA_ADMINS is not configured -- denying all requests to this route by default',
      {
        correlationId: req.correlationId,
        operation: `${req.method} ${req.path}`,
      }
    );
    return res.status(503).json({
      success: false,
      error: 'This action requires AICA_ADMINS to be configured on the service',
      timestamp: new Date().toISOString(),
    });
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

module.exports = { requireAdmin };
