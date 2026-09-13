const { OAuthService } = require('@liferay/accelerator-sdk');
const { ErrorHandler } = require('../utils/errorHandler.cjs');

// A warehouse batch failed against production with "networkCode:
// ERR_BAD_REQUEST" and a message about batch creation, which sends you to
// inspect the payload. The payload was fine; the status was 401. The same
// missing status made every retry classifier read the failure as transient,
// so one bad credential produced request after request (#890).
//
// This was fixed here first, in a PatchedOAuthService subclass. SDK #238 fixed
// it upstream and the subclass is gone (#925), so these now run against the
// SDK's own OAuthService - which is the point of keeping them. The behaviour
// this service depends on now belongs to a dependency, and a dependency can
// regress without anything here changing.
describe('a rejected token keeps the status that rejected it', () => {
  let service;

  const refuse = (status) => {
    const error = new Error('Request failed with status code ' + status);

    // What axios raises for any rejected 4xx, and the value that surfaced as
    // the reported cause of the 401.
    error.code = 'ERR_BAD_REQUEST';
    error.response = { data: { error: 'invalid_client' }, status };

    return error;
  };

  const thrownFor = (status) => {
    try {
      service._handleException(refuse(status), 'http://liferay', 'client-id');
    } catch (error) {
      return error;
    }

    throw new Error('_handleException did not throw');
  };

  beforeEach(() => {
    service = new OAuthService({ logger: { error: vi.fn() } });
  });

  it('carries the response the REST layer looks for', () => {
    expect(thrownFor(401).response).toEqual({
      data: { error: 'invalid_client' },
      status: 401,
    });
  });

  it('reports 401 rather than a network code', () => {
    const error = thrownFor(401);

    // `statusCode` rather than `status`: the local subclass set both, the SDK
    // sets this one. Nothing reads the bare `status` on this path - the error
    // handler takes `error.response.status` when a response is present, and
    // only falls back to `status` when there is none.
    expect(error.statusCode).toBe(401);
    expect(error.response.status).toBe(401);

    // Axios labels every rejected 4xx ERR_BAD_REQUEST. Carried onto an error
    // that has its response it is redundant, and it was the value that
    // surfaced as the reported cause of the 401.
    expect(error.code).toBeUndefined();
  });

  it('is not worth retrying, which is what stopped the fifty-first attempt', () => {
    expect(ErrorHandler.isRetryableError(thrownFor(401))).toBe(false);
    expect(ErrorHandler.isRetryableError(thrownFor(403))).toBe(false);
  });

  it('leaves a 500 on the token endpoint retryable', () => {
    expect(ErrorHandler.isRetryableError(thrownFor(500))).toBe(true);
  });

  it('keeps the connection failures that never had a response', () => {
    const offline = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });

    try {
      service._handleException(offline, 'http://liferay', 'client-id');
      throw new Error('_handleException did not throw');
    } catch (error) {
      expect(error.message).toContain('Network connection failed');
      expect(error.response).toBeUndefined();
    }
  });
});
