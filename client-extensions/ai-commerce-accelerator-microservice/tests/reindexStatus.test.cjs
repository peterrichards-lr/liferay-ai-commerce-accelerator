const {
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
} = require('../utils/reindexStatus.cjs');

const httpError = (status) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });

describe('reindex status', () => {
  beforeEach(() => resetReindexStatus());

  describe('classifyReindexError', () => {
    it('treats a 404 as the module not being deployed', () => {
      // A different problem from a reindex that ran and failed, and a
      // different remedy - so it must not be reported as a generic failure.
      expect(classifyReindexError(httpError(404))).toEqual({
        state: ENDPOINT_MISSING,
        message: MISSING_MESSAGE,
      });
    });

    it.each([500, 502, 403, 401])('treats %s as a failure', (status) => {
      expect(classifyReindexError(httpError(status)).state).toBe(FAILED);
    });

    it('handles an error with no HTTP status', () => {
      const result = classifyReindexError(new Error('socket hang up'));
      expect(result.state).toBe(FAILED);
      expect(result.message).toMatch(/socket hang up/);
    });

    it('reads a status from statusCode as well as response.status', () => {
      expect(
        classifyReindexError(Object.assign(new Error('x'), { statusCode: 404 }))
          .state
      ).toBe(ENDPOINT_MISSING);
    });

    it('survives a null error', () => {
      expect(classifyReindexError(null).state).toBe(FAILED);
    });
  });

  describe('health reporting', () => {
    it('is healthy before anything has been attempted', () => {
      // A fresh boot has not failed at anything; reporting degraded here would
      // make the signal meaningless.
      expect(reindexHealth()).toEqual({
        status: 'healthy',
        message: 'No search reindex has been attempted yet',
      });
    });

    it('is degraded, never unhealthy, after a failure', () => {
      // unhealthy would turn /health into a 503 and break readiness probes.
      // The service works and the data is correct; only indexing did not run.
      recordReindexFailure(httpError(404));
      expect(reindexHealth().status).toBe('degraded');

      recordReindexFailure(new Error('boom'));
      expect(reindexHealth().status).toBe('degraded');
    });

    it('explains a missing endpoint in terms an operator can act on', () => {
      recordReindexFailure(httpError(404));
      const { message } = reindexHealth();

      expect(message).toMatch(/not available/);
      expect(message).toMatch(/may not appear in the storefront/);
      expect(message).toMatch(/aica-reindex OSGi module/);
    });

    it('returns to healthy after a success', () => {
      recordReindexFailure(httpError(404));
      recordReindexSuccess();

      expect(reindexHealth().status).toBe('healthy');
      expect(getReindexStatus().state).toBe(OK);
    });
  });

  describe('recorded outcome', () => {
    it('starts as not attempted', () => {
      expect(getReindexStatus().state).toBe(NOT_ATTEMPTED);
      expect(getReindexStatus().at).toBeNull();
    });

    it('keeps the detail it was given, so a failure can be traced', () => {
      recordReindexFailure(httpError(500), { sessionId: 'SESSION-1' });
      expect(getReindexStatus().detail).toEqual({ sessionId: 'SESSION-1' });
      expect(getReindexStatus().at).toBeTruthy();
    });

    it('hands back a copy rather than the live object', () => {
      recordReindexSuccess();
      const snapshot = getReindexStatus();
      snapshot.state = 'TAMPERED';

      expect(getReindexStatus().state).toBe(OK);
    });
  });
});
