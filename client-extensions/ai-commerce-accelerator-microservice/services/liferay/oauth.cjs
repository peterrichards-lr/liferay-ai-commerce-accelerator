const { OAuthService } = require('@liferay/accelerator-sdk');

class PatchedOAuthService extends OAuthService {
  async _createOrGetAccessToken(liferayUrl, clientId, clientSecret) {
    const targetTokenUrl = liferayUrl
      ? `${liferayUrl.replace(/\/+$/, '')}/o/oauth2/token`
      : this.tokenEndpoint;

    const cacheKey = this._generateCacheKey(liferayUrl, clientId);
    const cached = this._getAccessTokenFromCache(cacheKey);
    if (cached) return cached;

    if (this.pendingTokenPromises.has(cacheKey)) {
      return this.pendingTokenPromises.get(cacheKey);
    }

    const promise = (async () => {
      try {
        const response = await this._createAccessTokenWithRetry(
          targetTokenUrl,
          clientId,
          clientSecret
        );
        const token = response.data.access_token;
        const expiresIn = response.data.expires_in || 3600;
        this._addAccessTokenToCache(cacheKey, token, expiresIn);
        return token;
      } finally {
        this.pendingTokenPromises.delete(cacheKey);
      }
    })();

    this.pendingTokenPromises.set(cacheKey, promise);
    return promise;
  }

  /**
   * The status a rejected token request came back with, kept on the error.
   *
   * The base implementation replaces the axios error with a new one carrying
   * `statusCode` and, from `error.code`, axios's generic `ERR_BAD_REQUEST`.
   * Nothing downstream reads `statusCode`: the REST layer decides whether a
   * failure had an HTTP response by looking for `response`, and every retry
   * classifier in the SDK and in this service reads `response.status`. So a
   * 401 on the token endpoint arrived everywhere as a response-less failure,
   * and both of the things that look at one got it wrong (#890):
   *
   * - the wrapped `LiferayRequestError` reported `networkCode:
   *   ERR_BAD_REQUEST` with no status, which reads as a malformed payload and
   *   sends you to inspect the request body, and
   * - `isRetryableError` returns true for anything without a `response`, so
   *   credentials that will never be accepted were tried again on every call.
   *   A single bad secret produced 141 token requests against this instance,
   *   and against production that is rate limiting and security alerting.
   *
   * Carrying the response through is all either one needs: the status names
   * the cause, and 401 and 403 stop being retryable because they stop looking
   * transient. `errorType` and `field` are preserved because the health check
   * reports on them.
   */
  _handleException(error, liferayUrl = null, clientId = null) {
    try {
      super._handleException(error, liferayUrl, clientId);
    } catch (wrapped) {
      if (error?.response) {
        wrapped.response = error.response;
        wrapped.status = error.response.status;
        // Axios labels every rejected 4xx ERR_BAD_REQUEST. With the response
        // attached it is both redundant and misleading, and it is the value
        // that surfaced as the reported cause of a 401.
        delete wrapped.code;
      }

      throw wrapped;
    }
  }
}

module.exports = PatchedOAuthService;
