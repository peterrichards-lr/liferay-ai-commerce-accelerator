const { lxcConfig, lookupConfig } = require('@rotty3000/config-node');
const { createERC } = require('./misc.cjs');
const { ERC_PREFIX, ENV } = require('./constants.cjs');
const { logger } = require('./logger.cjs');

// Where a target came from when the request did not carry one. Named so the
// warning can say which link supplied it: "the environment" is not an answer an
// operator can act on. See #815.
const TARGET_SOURCE = {
  REQUEST: 'request',
  OAUTH_DEFAULT: 'oauth-service-default',
  COLOCATED_ROUTES: 'colocated-lxc-routes',
  ENV: 'env:LIFERAY_API_URL',
  PERSISTED: 'persisted:active_liferay_url',
};

function isValidAbsoluteUrl(maybeUrl) {
  if (!maybeUrl || typeof maybeUrl !== 'string') return false;
  try {
    const u = new URL(maybeUrl);
    return !!(u.protocol && u.host);
  } catch {
    return false;
  }
}

/**
 * Whether two URLs name the same Liferay, by host. Used to tell the ordinary
 * colocated request - which states its own portal URL and leaves the
 * credentials to the routes tree - apart from the case worth a warning, where
 * credentials minted for one instance are about to be sent to another. See
 * #815.
 */
function isSameLiferayHost(one, other) {
  if (!isValidAbsoluteUrl(one) || !isValidAbsoluteUrl(other)) return false;
  return new URL(one).host === new URL(other).host;
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
  let liferayUrlSource = TARGET_SOURCE.REQUEST;

  if (!isValidAbsoluteUrl(liferayUrl)) {
    // Same order and same "first truthy wins" as the || chain this replaces -
    // an invalid but truthy candidate still short-circuits and still fails the
    // validity check below. The only thing added is remembering which link
    // answered, so the substitution can be reported. See #815.
    const fallbacks = [
      [
        TARGET_SOURCE.OAUTH_DEFAULT,
        () =>
          typeof oauthService?.getDefaultLiferayUrl === 'function'
            ? oauthService.getDefaultLiferayUrl()
            : null,
      ],
      [TARGET_SOURCE.COLOCATED_ROUTES, () => tryBuildColocatedLiferayUrl()],
      [TARGET_SOURCE.ENV, () => ENV.LIFERAY_API_URL],
      [
        TARGET_SOURCE.PERSISTED,
        () => persistence?.getSystemSetting?.('active_liferay_url'),
      ],
    ];

    liferayUrl = null;
    liferayUrlSource = null;

    for (const [source, read] of fallbacks) {
      const candidate = read();

      if (candidate) {
        liferayUrl = candidate;
        liferayUrlSource = source;
        break;
      }
    }
  }

  // 2. Resolve Credentials based on location
  const requestSuppliedCredentials = !!(clientId || clientSecret);

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

  // The substitution is announced, not merely made. #815 was found by reading
  // a token log - two requests two seconds apart, different hosts and different
  // clients - because nothing at this level said a word. WARN rather than DEBUG:
  // the routes that write now refuse an unstated target outright, so whatever
  // still reaches here inferred one, and the operator should be able to see
  // which link answered.
  if (liferayUrlSource !== TARGET_SOURCE.REQUEST) {
    logger.warn(
      'Liferay target was not stated by the caller and has been inferred',
      {
        correlationId: config.correlationId,
        liferayUrl,
        operation: 'liferay-url-resolution',
        source: liferayUrlSource,
      }
    );
  } else if (!requestSuppliedCredentials && (clientId || clientSecret)) {
    // The other half of the same hazard: the caller named its instance but the
    // credentials came from elsewhere. Only worth saying when "elsewhere" is a
    // different Liferay - a colocated request states its own portal URL and
    // leaves the credentials to the routes tree, which is the normal case and
    // must not warn on every request.
    const credentialOrigin = hasRouteCredentials
      ? (typeof oauthService?.getDefaultLiferayUrl === 'function'
          ? oauthService.getDefaultLiferayUrl()
          : null) || tryBuildColocatedLiferayUrl()
      : ENV.LIFERAY_API_URL ||
        persistence?.getSystemSetting?.('active_liferay_url');

    if (credentialOrigin && !isSameLiferayHost(credentialOrigin, liferayUrl)) {
      logger.warn(
        'Liferay credentials belong to a different instance than the one the caller named',
        {
          correlationId: config.correlationId,
          credentialOrigin,
          liferayUrl,
          operation: 'liferay-auth-resolution',
          source: hasRouteCredentials
            ? 'colocated-oauth-headers'
            : 'env-or-persisted',
        }
      );
    }
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
