const { lxcConfig } = require('@rotty3000/config-node');
const axios = require('axios');
const { createExternalReferenceCode } = require('../utils/misc.cjs');

const { APP_ERCS } = require('../utils/constants.cjs');

const serverOauthApp = lxcConfig.oauthApplication(
  APP_ERCS.OAUTH_SERVER_EXTERNAL_REFERENCE_CODE
);

class OAuthService {
  constructor(ctx) {
    this.ctx = ctx;
    const lxcDXPMainDomain = lxcConfig.dxpMainDomain();
    const lxcDXPServerProtocol = lxcConfig.dxpProtocol();
    const uri = serverOauthApp.tokenUri();
    this.liferayUrl = `${lxcDXPServerProtocol}://${lxcDXPMainDomain}`;
    this.tokenEndpoint = `${this.liferayUrl}${uri}`;
  }

  _generateCacheKey(liferayUrl, clientId) {
    return `${liferayUrl}_${clientId}`;
  }

  _getAccessTokenFromCache(cacheKey) {
    const { cacheService: tokenCache } = this.ctx;
    const cached = tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
    return null;
  }

  _addAccessTokenToCache(cacheKey, token, expiresIn = 3600) {
    const { cacheService: tokenCache } = this.ctx;
    tokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    });
  }

  async _createAccessToken(tokenUrl, clientId, clientSecret) {
    const { logger } = this.ctx;
    logger.debug(`Creating new access token for ${clientId} using ${tokenUrl}`);
    return await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
  }

  _getTokenUrl(liferayUrl) {
    return `${liferayUrl}/o/oauth2/token`;
  }

  async _createOrGetAccessToken(liferayUrl, clientId, clientSecret) {
    const cacheKey = this._generateCacheKey(liferayUrl, clientId);
    let token = this._getAccessTokenFromCache(cacheKey);
    if (token) {
      return token;
    }

    const tokenUrl = this.tokenEndpoint ?? this._getTokenUrl(liferayUrl);
    const response = await this._createAccessToken(
      tokenUrl,
      clientId,
      clientSecret
    );
    token = response.data.access_token;
    const expiresIn = response.data.expires_in || 3600;

    this._addAccessTokenToCache(cacheKey, token, expiresIn);

    return token;
  }

  _handleException(error, liferayUrl = null, clientId = null) {
    const errorRef = createExternalReferenceCode();

    logger.error(`OAuth Error [${errorRef}]:`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
      stack: error.stack,
      url: liferayUrl,
      clientId: clientId,
      timestamp: new Date().toISOString(),
    });

    let customError;

    if (
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT'
    ) {
      customError = new Error(`Network connection failed: ${error.code}`);
      customError.statusCode = 0; // Network error, no HTTP status
    } else if (
      error.response?.status === 401 ||
      error.response?.status === 403
    ) {
      customError = new Error('OAuth authentication failed');
      customError.statusCode = error.response.status;
      customError.errorType = 'auth_error';
      customError.field = 'clientSecret';
    } else {
      customError = new Error(`OAuth request failed: ${error.message}`);
      customError.statusCode = error.response?.status || 500;
    }

    customError.errorReference = errorRef;
    customError.code = error.code; // Preserve original error code
    throw customError;
  }

  async getAccessTokenFromRoute() {
    const { logger } = this.ctx;

    const clientId = serverOauthApp.clientId();
    const clientSecret = serverOauthApp.clientSecret();

    if (!this.liferayUrl || !clientId || !clientSecret) {
      const errorRef = createExternalReferenceCode();
      logger.error(
        `OAuth Error [${errorRef}]: Unable to obtain LXC configuration`,
        {
          liferayUrl: this.liferayUrl || 'undefined',
          clientId: clientId || 'undefined',
          clientSecret: clientSecret ? '[PROVIDED]' : 'undefined',
          timestamp: new Date().toISOString(),
        }
      );

      const customError = new Error('OAuth configuration not found');
      customError.statusCode = 500;
      customError.errorReference = errorRef;
      throw customError;
    }

    try {
      return this._createOrGetAccessToken(
        this.liferayUrl,
        clientId,
        clientSecret
      );
    } catch (error) {
      this._handleException(error, this.liferayUrl, clientId);
    }
  }

  async getAccessTokenWithCredentials(liferayUrl, clientId, clientSecret) {
    const { logger } = this.ctx;
    if (!liferayUrl || !clientId || !clientSecret) {
      const errorRef = createExternalReferenceCode();
      logger.error(`OAuth Error [${errorRef}]: Missing required parameters`, {
        liferayUrl: liferayUrl || 'undefined',
        clientId: clientId || 'undefined',
        clientSecret: clientSecret ? '[PROVIDED]' : 'undefined',
        timestamp: new Date().toISOString(),
      });

      const customError = new Error('OAuth configuration missing');
      customError.statusCode = 400;
      customError.errorReference = errorRef;
      throw customError;
    }

    try {
      return this._createOrGetAccessToken(liferayUrl, clientId, clientSecret);
    } catch (error) {
      this._handleException(error, liferayUrl, clientId);
    }
  }

  async getAccessToken(liferayUrl, clientId, clientSecret) {
    return !liferayUrl || !clientId || !clientSecret
      ? this.getAccessTokenFromRoute()
      : this.getAccessTokenWithCredentials(liferayUrl, clientId, clientSecret);
  }

  async getAccessTokenWithCode(
    liferayUrl,
    clientId,
    clientSecret,
    code,
    redirectUri
  ) {
    const { logger } = this.ctx;
    try {
      const response = await axios.post(
        this._getTokenUrl(liferayUrl),
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
          redirect_uri: redirectUri,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error) {
      const errorRef = createExternalReferenceCode();
      logger.error(
        `OAuth code exchange failed [${errorRef}]:`,
        error.response?.data || error.message
      );
      const customError = new Error(
        `OAuth code exchange failed: ${
          error.response?.data?.error_description || error.message
        }`
      );
      customError.statusCode = error.response?.status || 500;
      customError.errorReference = errorRef;
      throw customError;
    }
  }

  generateAuthUrl(liferayUrl, clientId, redirectUri, state = null) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope:
        'Liferay.Headless.Commerce.Admin.Catalog.everything Liferay.Headless.Commerce.Admin.Channel.everything Liferay.Headless.Commerce.Admin.Order.everything Liferay.Headless.Commerce.Admin.Pricing.everything Liferay.Headless.Commerce.Admin.Account.everything',
    });

    if (state) {
      params.append('state', state);
    }

    return `${liferayUrl}/o/oauth2/authorize?${params.toString()}`;
  }

  clearTokenCache() {
    const { cacheService: tokenCache } = this.ctx;
    tokenCache.clear();
  }

  isLiferayRouteAvailable() {
    return (
      tokenEndpoint &&
      serverOauthApp.clientId() &&
      serverOauthApp.clientSecret()
    );
  }

  validateOAuthConfig(config) {
    const required = ['liferayUrl', 'clientId', 'clientSecret'];
    const missing = required.filter((field) => !config[field]);

    if (missing.length > 0) {
      throw new Error(`Missing OAuth configuration: ${missing.join(', ')}`);
    }
  }
}

module.exports = OAuthService;
