/**
 * Remembers the outcome of the last search reindex attempt, so a failure is
 * reported rather than only logged.
 *
 * Reindexing is best-effort by design: a completed generation should not be
 * marked failed because indexing did not fire, and the data is correct and
 * usable either way. But "do not fail the workflow" had been implemented as
 * "do not mention it" - both callers caught the error and wrote a
 * logger.warn - so an unreachable endpoint produced generated products that
 * were never indexed, with no signal anywhere the operator looks. That is how
 * run-e2e-ldm.sh came to delete the reindex bundle from fresh environments for
 * two months without anyone noticing (#614).
 *
 * The state is process-wide because that is what it describes: the last thing
 * this microservice observed when it asked Liferay to reindex. It is not a
 * probe - nothing is triggered to find out, since triggering a reindex to
 * check whether reindexing works would itself be a side effect.
 */
const { REINDEX_BASE_PATH } = require('./liferayUtils.cjs');

const NOT_ATTEMPTED = 'NOT_ATTEMPTED';
const OK = 'OK';
const ENDPOINT_MISSING = 'ENDPOINT_MISSING';
const SCOPE_DENIED = 'SCOPE_DENIED';
const FAILED = 'FAILED';

// Named to match the grant in client-extension.yaml. Not read from a shared
// source - it is the module's own osgi.jaxrs.name, fixed regardless of which
// application base a deployment answers on - so the two have to be kept in
// sync by hand if either changes. See #675.
const REINDEX_SCOPE = 'Custom.Search.Reindex.everything.write';

const MISSING_MESSAGE =
  `The reindex endpoint (${REINDEX_BASE_PATH}) is not available, so generated ` +
  'content has not been indexed and may not appear in the storefront. The ' +
  'search-reindex OSGi module is probably not deployed there.';

// Liferay scope-checks any JAX-RS application declaring no
// oauth2.scope.checker.type before the request reaches the module code, so a
// 401 or 403 here means the call was refused at that gate rather than by the
// module - a scope problem, not a missing deployment, with a different
// remedy. Its body is empty either way, so the status is the only signal:
// this cannot rule out a plain authentication failure (an expired or revoked
// token looks identical from here), which is why the message ends by naming
// that possibility rather than only the scope-shaped ones ahead of it - in
// likelihood order, not in the order a developer would think to check them.
// See #675.
const SCOPE_DENIED_MESSAGE =
  `Reindexing at ${REINDEX_BASE_PATH} was refused before the search-reindex ` +
  "module saw the request - the call reached Liferay's OAuth gate, not the " +
  'module itself - so generated content has not been indexed and may not ' +
  'appear in the storefront. Check first that client-extension.yaml grants ' +
  `${REINDEX_SCOPE}. If it does, check that the grant is for a module ` +
  `deployed at ${REINDEX_BASE_PATH}, not a different one. An expired or ` +
  'revoked token would look identical from here, so rule that out too.';

let last = { state: NOT_ATTEMPTED, message: null, at: null, detail: null };

function httpStatusOf(error) {
  return error?.response?.status ?? error?.statusCode ?? error?.status ?? null;
}

/**
 * A 404 means the JAX-RS application is not registered - the module is not
 * deployed - which is a different problem from a reindex that was attempted and
 * failed, and has a different remedy. A 401/403 means it is registered and
 * refused the call before the module ran, which is a different problem again.
 * See #675.
 */
function classifyReindexError(error) {
  const status = httpStatusOf(error);

  if (status === 404) {
    return { state: ENDPOINT_MISSING, message: MISSING_MESSAGE };
  }

  if (status === 401 || status === 403) {
    return { state: SCOPE_DENIED, message: SCOPE_DENIED_MESSAGE };
  }

  return {
    state: FAILED,
    message: `Search reindexing failed: ${error?.message || 'unknown error'}`,
  };
}

function recordReindexSuccess(detail = null) {
  last = { state: OK, message: null, at: new Date().toISOString(), detail };
  return last;
}

function recordReindexFailure(error, detail = null) {
  const { state, message } = classifyReindexError(error);
  last = { state, message, at: new Date().toISOString(), detail };
  return last;
}

function getReindexStatus() {
  return { ...last };
}

/**
 * Reported as `degraded` rather than `unhealthy`: the service is working and
 * the data is correct, so this must not turn a readiness probe into a 503.
 */
function reindexHealth() {
  const current = getReindexStatus();

  if (current.state === OK) {
    return {
      status: 'healthy',
      message: `Search reindexing succeeded at ${current.at}`,
    };
  }

  if (current.state === NOT_ATTEMPTED) {
    return {
      status: 'healthy',
      message: 'No search reindex has been attempted yet',
    };
  }

  return { status: 'degraded', message: current.message };
}

/**
 * Test seam. Production code never needs this.
 */
function resetReindexStatus() {
  last = { state: NOT_ATTEMPTED, message: null, at: null, detail: null };
}

module.exports = {
  ENDPOINT_MISSING,
  FAILED,
  MISSING_MESSAGE,
  NOT_ATTEMPTED,
  OK,
  REINDEX_SCOPE,
  SCOPE_DENIED,
  SCOPE_DENIED_MESSAGE,
  classifyReindexError,
  getReindexStatus,
  recordReindexFailure,
  recordReindexSuccess,
  reindexHealth,
  resetReindexStatus,
};
