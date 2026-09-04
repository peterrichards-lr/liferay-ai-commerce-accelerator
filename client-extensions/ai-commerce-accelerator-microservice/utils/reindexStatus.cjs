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
const NOT_ATTEMPTED = 'NOT_ATTEMPTED';
const OK = 'OK';
const ENDPOINT_MISSING = 'ENDPOINT_MISSING';
const FAILED = 'FAILED';

const ENDPOINT_PATH = '/o/aica-reindex';

const MISSING_MESSAGE =
  `The reindex endpoint (${ENDPOINT_PATH}) is not available, so generated ` +
  'content has not been indexed and may not appear in the storefront. The ' +
  'aica-reindex OSGi module is probably not deployed.';

let last = { state: NOT_ATTEMPTED, message: null, at: null, detail: null };

function httpStatusOf(error) {
  return error?.response?.status ?? error?.statusCode ?? error?.status ?? null;
}

/**
 * A 404 means the JAX-RS application is not registered - the module is not
 * deployed - which is a different problem from a reindex that was attempted and
 * failed, and has a different remedy.
 */
function classifyReindexError(error) {
  if (httpStatusOf(error) === 404) {
    return { state: ENDPOINT_MISSING, message: MISSING_MESSAGE };
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
  classifyReindexError,
  getReindexStatus,
  recordReindexFailure,
  recordReindexSuccess,
  reindexHealth,
  resetReindexStatus,
};
