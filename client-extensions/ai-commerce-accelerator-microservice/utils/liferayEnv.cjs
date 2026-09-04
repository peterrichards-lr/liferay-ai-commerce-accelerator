const { lxcConfig, lookupConfig } = require('@rotty3000/config-node');
const { createERC } = require('./misc.cjs');
const { ERC_PREFIX, ENV } = require('./constants.cjs');

function isValidAbsoluteUrl(maybeUrl) {
  if (!maybeUrl || typeof maybeUrl !== 'string') return false;
  try {
    const u = new URL(maybeUrl);
    return !!(u.protocol && u.host);
  } catch {
    return false;
  }
}

function tryBuildColocatedLiferayUrl() {
  try {
    const liferayServerProtocol = lookupConfig(
      'com.liferay.lxc.dxp.server.protocol'
    );
    const liferayServerDomain = lxcConfig.dxpMainDomain();
    const built = `${liferayServerProtocol}://${liferayServerDomain}`;
    if (isValidAbsoluteUrl(built)) return built;
  } catch {
    // Ignore error
  }
  return null;
}

function resolveEffectiveLiferayConnection(
  config = {},
  oauthService,
  persistence
) {
  const errorReference = createERC(ERC_PREFIX.ERROR);

  // Named for what it actually tests: whether the OAuth application was
  // resolved from the routes tree Liferay writes, which requires
  // LIFERAY_ROUTES_CLIENT_EXTENSION and LIFERAY_ROUTES_DXP to point at it.
  //
  // This used to be called isColocated, which conflated two questions and made
  // a discovery failure look like a deployment topology. See
  // accelerator-sdk#159 - while the SDK looked up the wrong external reference
  // code, this was always false, and the standalone branch below silently
  // became the only path.
  const hasRouteCredentials =
    typeof oauthService?.isLiferayRouteAvailable === 'function' &&
    oauthService.isLiferayRouteAvailable();

  let liferayUrl = config.liferayUrl;
  let clientId = config.clientId;
  let clientSecret = config.clientSecret;

  // 1. Resolve Liferay URL
  if (!isValidAbsoluteUrl(liferayUrl)) {
    liferayUrl =
      (typeof oauthService?.getDefaultLiferayUrl === 'function'
        ? oauthService.getDefaultLiferayUrl()
        : null) ||
      tryBuildColocatedLiferayUrl() ||
      ENV.LIFERAY_API_URL ||
      persistence?.getSystemSetting?.('active_liferay_url') ||
      null;
  }

  // 2. Resolve Credentials based on location
  if (hasRouteCredentials) {
    if (!clientId && typeof oauthService?.getDefaultClientId === 'function') {
      clientId = oauthService.getDefaultClientId();
    }

    if (
      !clientSecret &&
      typeof oauthService?.getDefaultClientSecret === 'function'
    ) {
      clientSecret = oauthService.getDefaultClientSecret();
    }
  } else {
    // STANDALONE / LOCAL: Fallback to ENV then DB if config is empty
    if (!clientId) {
      clientId =
        ENV.LIFERAY_OAUTH_CLIENT_ID ||
        persistence?.getSystemSetting?.('active_client_id');
    }
    if (!clientSecret) {
      clientSecret =
        ENV.LIFERAY_OAUTH_CLIENT_SECRET ||
        persistence?.getSystemSetting?.('active_client_secret');
    }
  }

  if (!isValidAbsoluteUrl(liferayUrl)) {
    const e = new Error(
      'Liferay URL is not configured. Please provide liferayUrl in the request or set LIFERAY_API_URL.'
    );
    e.name = 'LiferayRequestError';
    e.operation = 'liferay-url-resolution';
    e.userMessage =
      'Missing Liferay URL. Provide a valid liferayUrl in the AI Commerce Accelerator configuration or environment.';
    e.errorReference = errorReference;
    e.problem = {
      status: 'CONFIGURATION_ERROR',
      detail:
        'No liferayUrl was provided, and this service cannot derive one from the environment.',
    };
    throw e;
  }

  // VALIDATION: We either need OAuth credentials OR Basic Auth credentials (checked later in rest.cjs)
  const hasOAuth = clientId && clientSecret;
  const hasBasic = ENV.LIFERAY_API_USERNAME && ENV.LIFERAY_API_PASSWORD;

  if (!hasRouteCredentials && !hasOAuth && !hasBasic) {
    const e = new Error('Liferay authentication is not configured');
    e.name = 'LiferayRequestError';
    e.operation = 'liferay-auth-resolution';
    e.userMessage =
      'Liferay authentication is not configured. Please provide Client ID and Client Secret in the AI Configuration, or set system environment variables.';
    e.errorReference = errorReference;
    e.problem = {
      status: 'AUTH_CONFIG_ERROR',
      detail:
        'No authentication credentials (OAuth or Basic) were found in the request or environment.',
    };
    throw e;
  }

  // Field name kept for callers; see the comment above on what it means.
  return {
    liferayUrl,
    clientId,
    clientSecret,
    isColocated: hasRouteCredentials,
  };
}

module.exports = {
  isValidAbsoluteUrl,
  tryBuildColocatedLiferayUrl,
  resolveEffectiveLiferayConnection,
};
