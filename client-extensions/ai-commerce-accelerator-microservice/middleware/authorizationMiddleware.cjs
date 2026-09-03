const { logger } = require('../utils/logger.cjs');

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

  const rawAdmins =
    process.env.AICA_ADMINS || process.env.AICA_ADMIN_EMAILS || '';
  const allowlist = rawAdmins
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

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

  const callerEmail = (req.user.claims.email || '').toLowerCase();
  const callerId = String(req.user.claims.sub || '')
    .trim()
    .toLowerCase();
  const isAllowed =
    (callerEmail && allowlist.includes(callerEmail)) ||
    (callerId && allowlist.includes(callerId));

  if (!isAllowed) {
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
