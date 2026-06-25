const { lxcConfig } = require('@rotty3000/config-node');
const axios = require('axios');
const { createERC, normalizeNumber, delay } = require('../utils/misc.cjs');
const { APP_ERCS, ENV, ERC_PREFIX } = require('../utils/constants.cjs');

class OAuthService {
  constructor(ctx) {
    this.ctx = ctx;

    let serverOauthApp = null;
    try {
      serverOauthApp = lxcConfig.oauthApplication(
        APP_ERCS.OAUTH_SERVER_EXTERNAL_REFERENCE_CODE
      );
    } catch (e) {
      if (ctx?.logger?.warn) {
        ctx.logger.warn(
          `Could not resolve OAuth application config from LXC environment: ${e.message}`
        );
      }
    }

    const lxcDXPMainDomain = lxcConfig.dxpMainDomain();
    const lxcDXPServerProtocol = lxcConfig.dxpProtocol();
    const uri = serverOauthApp?.tokenUri?.();

    this.liferayUrl =
      lxcDXPMainDomain && lxcDXPServerProtocol
        ? `${lxcDXPServerProtocol}://${lxcDXPMainDomain}`
        : ENV.LIFERAY_API_URL;

    this.tokenEndpoint =
      this.liferayUrl && this.liferayUrl.trim()
        ? uri
          ? `${this.liferayUrl}${uri}`
          : `${this.liferayUrl}/o/oauth2/token`
        : null;

    this.pendingTokenPromises = new Map();
    this.serverOauthApp = serverOauthApp;

    this.settings = {
      httpTimeoutMs: normalizeNumber(ENV.OAUTH_HTTP_TIMEOUT_MS, {
        min: 3000,
        defaultValue: 15000,
      }),
      maxRetries: normalizeNumber(ENV.OAUTH_MAX_RETRIES, {
        min: 0,
        defaultValue: 2,
      }),
      backoffBaseMs: normalizeNumber(ENV.OAUTH_RETRY_BACKOFF_MS, {
        min: 100,
        defaultValue: 500,
      }),
      tokenSkewSec: normalizeNumber(ENV.OAUTH_TOKEN_SKEW_SEC, {
        min: 0,
        defaultValue: 60,
      }),
      tokenCacheTtlMs: normalizeNumber(ENV.OAUTH_TOKEN_CACHE_TTL, {
        min: 60000,
        defaultValue: 3600000,
      }),
    };

    const cfgSvc = this.ctx.config;
    const cached = cfgSvc?.getOAuthConfigCached?.();
    if (cached) this.applyConfig(cached);
  }

  applyConfig(cfg = {}) {
    const { logger } = this.ctx;
    const next = {
      httpTimeoutMs: normalizeNumber(cfg.httpTimeoutMs, {
        min: 3000,
        defaultValue: this.settings.httpTimeoutMs,
      }),
      maxRetries: normalizeNumber(cfg.maxRetries, {
        min: 0,
        defaultValue: this.settings.maxRetries,
      }),
      backoffBaseMs: normalizeNumber(cfg.backoffBaseMs, {
        min: 100,
        defaultValue: this.settings.backoffBaseMs,
      }),
      tokenSkewSec: normalizeNumber(cfg.tokenSkewSec, {
        min: 0,
        defaultValue: this.settings.tokenSkewSec,
      }),
      tokenCacheTtlMs: normalizeNumber(cfg.tokenCacheTtlMs, {
        min: 60000,
        defaultValue: this.settings.tokenCacheTtlMs,
      }),
    };
    this.settings = {
      httpTimeoutMs: Math.max(this.settings.httpTimeoutMs, next.httpTimeoutMs),
      maxRetries: Math.max(this.settings.maxRetries, next.maxRetries),
      backoffBaseMs: Math.max(this.settings.backoffBaseMs, next.backoffBaseMs),
      tokenSkewSec: Math.max(this.settings.tokenSkewSec, next.tokenSkewSec),
      tokenCacheTtlMs: Math.max(
        this.settings.tokenCacheTtlMs,
        next.tokenCacheTtlMs
      ),
    };
    logger?.debug?.('OAuthService config applied', {
      operation: 'oauth-config-apply',
      settings: this.settings,
    });
  }

  async refreshConfigFromRemote(config) {
    const { config: configService, logger } = this.ctx;
    if (!configService?.getOAuthConfig) return;
    try {
      const remote = await configService.getOAuthConfig(config);
      this.applyConfig(remote);
    } catch (e) {
      logger?.warn?.('OAuthService: failed to refresh config from remote', {
        operation: 'oauth-config-refresh',
        error: String(e?.message || e),
      });
    }
  }

  _generateCacheKey(liferayUrl, clientId) {
    return `${liferayUrl}_${clientId}`;
  }

  _getAccessTokenFromCache(cacheKey) {
    const tokenCache = this.ctx.cache;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
    return null;
  }

  _addAccessTokenToCache(cacheKey, token, expiresInSec = 3600) {
    const tokenCache = this.ctx.cache;
    const skewMs = this.settings.tokenSkewSec * 1000;
    const ttlMs = Math.max(0, expiresInSec * 1000 - skewMs);
    const hardCap = this.settings.tokenCacheTtlMs;
    const finalTtl = Math.min(ttlMs || hardCap, hardCap);
    tokenCache.set(
      cacheKey,
      {
        token,
        expiresAt: Date.now() + finalTtl,
      },
      finalTtl
    );
  }

  async _createAccessTokenOnce(tokenUrl, clientId, clientSecret) {
    const { logger } = this.ctx;
    logger?.debug?.(
      `Creating new access token for ${clientId} using ${tokenUrl}`
    );
    const res = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: this.settings.httpTimeoutMs,
      }
    );
    return res;
  }

  async _createAccessTokenWithRetry(tokenUrl, clientId, clientSecret) {
    const { logger } = this.ctx;
    let attempt = 0;
    const maxA = this.settings.maxRetries + 1;
    while (attempt < maxA) {
      try {
        return await this._createAccessTokenOnce(
          tokenUrl,
          clientId,
          clientSecret
        );
      } catch (err) {
        attempt++;
        const retriable =
          ![401, 403].includes(err?.response?.status) && attempt < maxA;
        logger?.warn?.('OAuth token request failed', {
          operation: 'oauth-token-request',
          attempt,
          maxAttempts: maxA,
          status: err?.response?.status,
          message: String(err?.message || err),
        });
        if (!retriable) throw err;
        const backoff = this.settings.backoffBaseMs * Math.pow(2, attempt - 1);
        await delay(backoff);
      }
    }
  }

  _getTokenUrl(liferayUrl) {
    return `${liferayUrl}/o/oauth2/token`;
  }

  async _createOrGetAccessToken(liferayUrl, clientId, clientSecret) {
    const cacheKey = this._generateCacheKey(liferayUrl, clientId);
    const cached = this._getAccessTokenFromCache(cacheKey);
    if (cached) return cached;

    if (this.pendingTokenPromises.has(cacheKey)) {
      return this.pendingTokenPromises.get(cacheKey);
    }

    const tokenUrl = this.tokenEndpoint ?? this._getTokenUrl(liferayUrl);
    const promise = (async () => {
      try {
        const response = await this._createAccessTokenWithRetry(
          tokenUrl,
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

  _handleException(error, liferayUrl = null, clientId = null) {
    const { logger } = this.ctx;
    const errorRef = createERC(ERC_PREFIX.ERROR);
    logger?.error?.(`OAuth Error [${errorRef}]:`, {
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      data: error?.response?.data,
      message: error?.message,
      stack: error?.stack,
      url: liferayUrl,
      clientId,
      timestamp: new Date().toISOString(),
    });

    let customError;
    if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error?.code)) {
      customError = new Error(`Network connection failed: ${error.code}`);
      customError.statusCode = 0;
    } else if (
      error?.response?.status === 401 ||
      error?.response?.status === 403
    ) {
      customError = new Error('OAuth authentication failed');
      customError.statusCode = error.response.status;
      customError.errorType = 'auth_error';
      customError.field = 'clientSecret';
    } else {
      customError = new Error(`OAuth request failed: ${error?.message}`);
      customError.statusCode = error?.response?.status || 500;
    }
    customError.errorReference = errorRef;
    customError.code = error?.code;
    throw customError;
  }

  async getAccessTokenFromRoute() {
    const { logger } = this.ctx;
    const clientId =
      this.serverOauthApp?.clientId?.() || ENV.LIFERAY_OAUTH_CLIENT_ID;
    const clientSecret =
      this.serverOauthApp?.clientSecret?.() || ENV.LIFERAY_OAUTH_CLIENT_SECRET;

    if (!this.liferayUrl || !clientId || !clientSecret) {
      const errorRef = createERC(ERC_PREFIX.ERROR);
      logger?.error?.(
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
      return await this._createOrGetAccessToken(
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
      const errorRef = createERC(ERC_PREFIX.ERROR);
      logger?.error?.(
        `OAuth Error [${errorRef}]: Missing required parameters`,
        {
          liferayUrl: liferayUrl || 'undefined',
          clientId: clientId || 'undefined',
          clientSecret: clientSecret ? '[PROVIDED]' : 'undefined',
          timestamp: new Date().toISOString(),
        }
      );
      const customError = new Error('OAuth configuration missing');
      customError.statusCode = 400;
      customError.errorReference = errorRef;
      throw customError;
    }

    try {
      return await this._createOrGetAccessToken(
        liferayUrl,
        clientId,
        clientSecret
      );
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
          code,
          redirect_uri: redirectUri,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: this.settings.httpTimeoutMs,
        }
      );
      return response.data;
    } catch (error) {
      const errorRef = createERC(ERC_PREFIX.ERROR);
      logger?.error?.(
        `OAuth code exchange failed [${errorRef}]:`,
        error?.response?.data || error?.message
      );
      const customError = new Error(
        `OAuth code exchange failed: ${
          error?.response?.data?.error_description || error?.message
        }`
      );
      customError.statusCode = error?.response?.status || 500;
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
    if (state) params.append('state', state);
    return `${liferayUrl}/o/oauth2/authorize?${params.toString()}`;
  }

  clearTokenCache() {
    const tokenCache = this.ctx.cache;
    tokenCache.clear();
  }

  isLiferayRouteAvailable() {
    return (
      this.tokenEndpoint &&
      (this.serverOauthApp?.clientId?.() || ENV.LIFERAY_OAUTH_CLIENT_ID) &&
      (this.serverOauthApp?.clientSecret?.() || ENV.LIFERAY_OAUTH_CLIENT_SECRET)
    );
  }

  validateOAuthConfig(config) {
    const required = ['liferayUrl', 'clientId', 'clientSecret'];
    const missing = required.filter((field) => !config[field]);
    if (missing.length > 0) {
      throw new Error(`Missing OAuth configuration: ${missing.join(', ')}`);
    }
  }

  getDefaultClientId() {
    return this.serverOauthApp?.clientId?.() || ENV.LIFERAY_OAUTH_CLIENT_ID;
  }
  getDefaultClientSecret() {
    return (
      this.serverOauthApp?.clientSecret?.() || ENV.LIFERAY_OAUTH_CLIENT_SECRET
    );
  }
  getDefaultLiferayUrl() {
    return this.liferayUrl;
  }
}

module.exports = OAuthService;
