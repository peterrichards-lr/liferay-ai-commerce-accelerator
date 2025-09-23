const axios = require('axios');
const crypto = require('crypto');
const { logger } = require('../utils/logger.cjs');

class OAuthService {
  constructor(liferayUrl, clientId, clientSecret) {
    this.liferayUrl = liferayUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokenCache = new Map();
  }

  generateCacheKey() {
    return `${this.liferayUrl}_${this.clientId}`;
  }

  generateErrorReference() {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(4).toString('hex');
    return `LIFR_${timestamp}_${randomBytes}`;
  }

  async getAccessToken(liferayUrl, clientId, clientSecret) {
    if (!liferayUrl || !clientId || !clientSecret) {
      const errorRef = this.generateErrorReference();
      console.error(`OAuth Error [${errorRef}]: Missing required parameters`, {
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

    const cacheKey = `${liferayUrl}_${clientId}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const tokenUrl = `${liferayUrl}/o/oauth2/token`;
    try {
      const response = await axios.post(
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

      const token = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;

      this.tokenCache.set(cacheKey, {
        token,
        expiresAt: Date.now() + (expiresIn - 60) * 1000,
      });

      return token;
    } catch (error) {
      const errorRef = this.generateErrorReference();

      console.error(`OAuth Error [${errorRef}]:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        stack: error.stack,
        url: tokenUrl,
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
  }

  async getAccessTokenWithCode(
    liferayUrl,
    clientId,
    clientSecret,
    code,
    redirectUri
  ) {
    try {
      const tokenUrl = `${liferayUrl}/o/oauth2/token`;

      const response = await axios.post(
        tokenUrl,
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
      const errorRef = this.generateErrorReference();
      console.error(
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
    this.tokenCache.clear();
  }

  validateOAuthConfig(config) {
    const required = ['liferayUrl', 'clientId', 'clientSecret'];
    const missing = required.filter((field) => !config[field]);

    if (missing.length > 0) {
      throw new Error(`Missing OAuth configuration: ${missing.join(', ')}`);
    }
  }
}

module.exports = { OAuthService };
