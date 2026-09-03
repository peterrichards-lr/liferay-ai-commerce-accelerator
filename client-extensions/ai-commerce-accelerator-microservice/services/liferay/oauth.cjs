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
}

module.exports = PatchedOAuthService;
