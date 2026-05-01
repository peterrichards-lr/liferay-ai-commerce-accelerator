const { lxcConfig, lookupConfig } = require('@rotty3000/config-node');
const { createERC } = require('./misc.cjs');
const { ERC_PREFIX } = require('./constants.cjs');

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

function resolveEffectiveLiferayConnection(config = {}, oauthService) {
  const errorReference = createERC(ERC_PREFIX.ERROR);

  const isColocated =
    typeof oauthService?.isLiferayRouteAvailable === 'function' &&
    oauthService.isLiferayRouteAvailable();

  let liferayUrl = config.liferayUrl;
  let clientId = config.clientId;
  let clientSecret = config.clientSecret;

  if (isColocated) {
    const svcUrl =
      typeof oauthService?.getDefaultLiferayUrl === 'function'
        ? oauthService.getDefaultLiferayUrl()
        : null;

    if (!isValidAbsoluteUrl(liferayUrl)) {
      liferayUrl = svcUrl || tryBuildColocatedLiferayUrl() || null;
    }

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
    if (!isValidAbsoluteUrl(liferayUrl)) {
      liferayUrl = null;
    }
  }

  if (!isValidAbsoluteUrl(liferayUrl)) {
    const e = new Error(
      'Liferay URL is not configured. Please provide liferayUrl in the request.'
    );
    e.name = 'LiferayRequestError';
    e.operation = 'liferay-url-resolution';
    e.userMessage =
      'Missing Liferay URL. Provide a valid liferayUrl in the AI Commerce Accelerator configuration.';
    e.errorReference = errorReference;
    e.problem = {
      status: 'CONFIGURATION_ERROR',
      detail:
        'No liferayUrl was provided, and this service cannot derive one automatically.',
    };
    throw e;
  }

  if (!isColocated) {
    if (!clientId || !clientSecret) {
      const e = new Error('OAuth configuration is incomplete');
      e.name = 'LiferayRequestError';
      e.operation = 'liferay-oauth-resolution';
      e.userMessage =
        'OAuth configuration is incomplete. Please provide Client ID and Client Secret in the AI Configuration.';
      e.errorReference = errorReference;
      e.problem = {
        status: 'AUTH_CONFIG_ERROR',
        detail:
          'clientId and/or clientSecret are missing. They must be supplied when running outside Liferay.',
      };
      throw e;
    }
  }

  return { liferayUrl, clientId, clientSecret, isColocated };
}

module.exports = {
  isValidAbsoluteUrl,
  tryBuildColocatedLiferayUrl,
  resolveEffectiveLiferayConnection,
};
