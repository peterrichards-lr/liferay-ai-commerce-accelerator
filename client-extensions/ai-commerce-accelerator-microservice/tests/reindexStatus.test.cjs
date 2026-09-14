const {
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
} = require('../utils/reindexStatus.cjs');
const { REINDEX_BASE_PATH } = require('../utils/liferayUtils.cjs');

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

    it.each([500, 502])('treats %s as a failure', (status) => {
      expect(classifyReindexError(httpError(status)).state).toBe(FAILED);
    });

    it.each([401, 403])(
      'treats %s as the call being refused before the module saw it, not a generic failure',
      (status) => {
        // #675: Liferay's 403 for a scope refusal has an empty body, so before
        // this it fell into the same FAILED bucket as every other error and
        // read as "Search reindexing failed: undefined" - indistinguishable
        // from a missing deployment or any other cause.
        expect(classifyReindexError(httpError(status))).toEqual({
          state: SCOPE_DENIED,
          message: SCOPE_DENIED_MESSAGE,
        });
      }
    );

    it('names both the base path and the OAuth scope in a scope-denied message, so the two can be checked against each other', () => {
      // #675: pointing the base path elsewhere without updating the scope
      // grant (or vice versa) is exactly the failure this exists to surface -
      // the message has to name both halves, not just one.
      const { message } = classifyReindexError(httpError(403));

      expect(message).toContain(REINDEX_BASE_PATH);
      expect(message).toContain(REINDEX_SCOPE);
    });

    it('does not claim the module is missing when the scope was denied', () => {
      // The two states have different remedies (grant a scope vs. deploy a
      // module) and must not share wording that points at the wrong one.
      const { message } = classifyReindexError(httpError(403));

      expect(message).not.toMatch(/probably not deployed/);
    });

    it("checks the scope grant before the base path, in likelihood order rather than a developer's check order", () => {
      // The grant simply not existing is the ordinary case; the base path and
      // the scope naming different deployments is the exotic one. Leading
      // with the exotic explanation sends an operator to compare paths when
      // they should first confirm the grant exists at all.
      const { message } = classifyReindexError(httpError(403));

      const grantCheckIndex = message.indexOf('client-extension.yaml grants');
      const pathCheckIndex = message.indexOf('deployed at');

      expect(grantCheckIndex).toBeGreaterThan(-1);
      expect(pathCheckIndex).toBeGreaterThan(-1);
      expect(grantCheckIndex).toBeLessThan(pathCheckIndex);
    });

    it('admits an expired or revoked token would look identical, rather than asserting a scope cause with false confidence', () => {
      // #675: this repository prefers admitting uncertainty to asserting a
      // plausible cause. A 403 here cannot rule out a token problem that has
      // nothing to do with scope, and the message must not imply otherwise.
      const { message } = classifyReindexError(httpError(403));

      expect(message).toMatch(/expired or revoked token/);
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
      expect(message).toMatch(/search-reindex OSGi module/);
      // #675: names the path this call actually used, not a guess.
      expect(message).toContain(REINDEX_BASE_PATH);
    });

    it('reports a scope denial as degraded too, with its own explanation', () => {
      recordReindexFailure(httpError(403));
      const health = reindexHealth();

      expect(health.status).toBe('degraded');
      expect(health.message).toBe(SCOPE_DENIED_MESSAGE);
      expect(getReindexStatus().state).toBe(SCOPE_DENIED);
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

  describe('the path named in a failure message (#674, #675)', () => {
    // MISSING_MESSAGE and SCOPE_DENIED_MESSAGE are built once while this
    // module is required, from utils/liferayUtils.cjs's REINDEX_BASE_PATH,
    // which itself resolves from ENV.LIFERAY_REINDEX_BASE_PATH while
    // utils/constants.cjs is required. Proving the message follows a
    // configured path - rather than merely matching whatever the default
    // happens to be - needs a real module reload with the variable set, the
    // same way tests/envSettings.test.cjs exercises constants.cjs.
    const RELOADED_MODULES = [
      '../utils/constants.cjs',
      '../utils/liferayUtils.cjs',
      '../utils/reindexStatus.cjs',
    ];

    function loadReindexStatus(reindexBasePath) {
      for (const m of RELOADED_MODULES) {
        delete require.cache[require.resolve(m)];
      }

      const previous = process.env.LIFERAY_REINDEX_BASE_PATH;
      if (reindexBasePath === undefined) {
        delete process.env.LIFERAY_REINDEX_BASE_PATH;
      } else {
        process.env.LIFERAY_REINDEX_BASE_PATH = reindexBasePath;
      }

      try {
        return require('../utils/reindexStatus.cjs');
      } finally {
        if (previous === undefined)
          delete process.env.LIFERAY_REINDEX_BASE_PATH;
        else process.env.LIFERAY_REINDEX_BASE_PATH = previous;

        for (const m of RELOADED_MODULES) {
          delete require.cache[require.resolve(m)];
        }
      }
    }

    it('names the SDK default when nothing overrides it', () => {
      const { MISSING_MESSAGE: message } = loadReindexStatus(undefined);
      expect(message).toContain('/o/search-reindex');
    });

    it('names a configured base path instead of the SDK default literal', () => {
      // The mutation this guards against: hardcoding '/o/search-reindex' back
      // into the message, as the pre-#675 code did. With the base path
      // configured away from the default, a hardcoded literal would still
      // pass every other assertion in this file but fail these two.
      const { MISSING_MESSAGE, SCOPE_DENIED_MESSAGE } = loadReindexStatus(
        '/o/totally-different-path'
      );

      expect(MISSING_MESSAGE).toContain('/o/totally-different-path');
      expect(MISSING_MESSAGE).not.toContain('/o/search-reindex');
      expect(SCOPE_DENIED_MESSAGE).toContain('/o/totally-different-path');
      expect(SCOPE_DENIED_MESSAGE).not.toContain('/o/search-reindex');
    });
  });
});
