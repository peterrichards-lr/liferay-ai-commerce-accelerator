const { lxcConfig, lookupConfig } = require('@rotty3000/config-node');
const { isColocatedDeployment } = require('./lxcReadiness.cjs');
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
  LXC_ENV: 'env:LIFERAY_LXC_DXP_MAIN_DOMAIN',
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

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '[::1]']);

function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(host) || /^127\./.test(host);
}

/**
 * Whether a candidate URL can actually reach Liferay from here.
 *
 * A colocated client extension can never reach Liferay on its own loopback:
 * Liferay is a different container, and `localhost` inside this one is this
 * one. Run 36014266810 measured the config tree holding
 * `com.liferay.lxc.dxp.main.domain = localhost`, and the process spent forty
 * minutes on `connect ECONNREFUSED 127.0.0.1:8080` calling itself.
 *
 * The same value is correct in local development, where the microservice is a
 * host process and Liferay really is on localhost - so the rule is conditional
 * on being colocated, never on the value alone. See #1137.
 */
function isUsableLiferayUrl(maybeUrl) {
  if (!isValidAbsoluteUrl(maybeUrl)) return false;
  if (!isColocatedDeployment()) return true;
  return !isLoopbackHost(new URL(maybeUrl).hostname);
}

function tryBuildLxcEnvLiferayUrl() {
  const domain = ENV.LIFERAY_LXC_DXP_MAIN_DOMAIN;
  if (!domain) return null;
  const built = `${ENV.LIFERAY_LXC_DXP_SERVER_PROTOCOL}://${domain}`;
  return isValidAbsoluteUrl(built) ? built : null;
}

function tryBuildColocatedLiferayUrl() {
  try {
    const liferayServerProtocol = lookupConfig(
      'com.liferay.lxc.dxp.server.protocol'
    );
    const liferayServerDomain = lxcConfig.dxpMainDomain();

    // Both, before interpolating. A missing domain produced the string
    // "http://undefined", which `isValidAbsoluteUrl` accepts - "undefined" is
    // a syntactically valid host - so an absent value became a confident
    // answer that then short-circuited the rest of the chain. Found by a test
    // for #1137 that expected this to return nothing.
    if (!liferayServerProtocol || !liferayServerDomain) return null;

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
      [TARGET_SOURCE.LXC_ENV, () => tryBuildLxcEnvLiferayUrl()],
      [TARGET_SOURCE.ENV, () => ENV.LIFERAY_API_URL],
      [
        TARGET_SOURCE.PERSISTED,
        () => persistence?.getSystemSetting?.('active_liferay_url'),
      ],
    ];

    liferayUrl = null;
    liferayUrlSource = null;

    // Both derived sources read the config tree, directly or through the SDK,
    // so both can carry Liferay's local listener rather than the host this
    // container can reach. An unusable candidate is refused and the chain
    // continues, rather than short-circuiting on it - which is what #1132
    // started doing once the tree became readable at all.
    const derivedSources = new Set([
      TARGET_SOURCE.OAUTH_DEFAULT,
      TARGET_SOURCE.COLOCATED_ROUTES,
    ]);

    for (const [source, read] of fallbacks) {
      const candidate = read();

      if (!candidate) continue;

      if (derivedSources.has(source) && !isUsableLiferayUrl(candidate)) {
        logger.warn(
          'Ignoring a Liferay URL that cannot be reached from this container',
          {
            candidate,
            correlationId: config.correlationId,
            operation: 'liferay-url-resolution',
            reason: 'loopback host in a colocated deployment',
            source,
          }
        );
        continue;
      }

      liferayUrl = candidate;
      liferayUrlSource = source;
      break;
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
    // Declared, because since SDK v0.10.0 it has to be.
    //
    // The check above has always treated LIFERAY_API_USERNAME and
    // LIFERAY_API_PASSWORD as sufficient to proceed, then said nothing about
    // them - it returned a config with no clientId and left the SDK to notice
    // the two variables and choose Basic on its own. SDK #236 removed that
    // inference: a process-wide pair of variables could change the auth
    // mechanism of every unrelated caller, and a config read returning no
    // clientId produced a request authenticated as somebody else rather than
    // the error it should have raised.
    //
    // So the decision this function already makes is now stated. An explicit
    // authMethod from the caller wins; this only fills the gap where the code
    // above resolved no OAuth credentials and accepted Basic instead.
    authMethod:
      config.authMethod ||
      (!hasRouteCredentials && !hasOAuth && hasBasic ? 'basic' : undefined),
  };
}

/**
 * A single authenticated call, made once at startup, and only when the
 * default resolution is actually going to authenticate this way.
 *
 * The validation above has always accepted LIFERAY_API_USERNAME and
 * LIFERAY_API_PASSWORD as sufficient to proceed and never exercised them. On
 * a colocated deployment OAuth resolves through the routes tree, so the
 * Basic pair sits untouched - a wrong password there stays invisible until
 * the one day OAuth is unavailable and a request actually needs Basic, which
 * is the worst possible day to learn it. See #950, and #714/#934/#945 for the
 * same shape: a value that is present, plausible, and wrong, with nothing
 * saying so.
 *
 * Gated on `authMethod` coming back as `'basic'` from the same resolution a
 * real request would get, not merely on the variables being set: a
 * deployment authenticating by OAuth has no use for this probe, and running
 * it anyway would be a pointless request on every boot that could fail for a
 * reason the operator never chose.
 *
 * @param {object} oauthService Passed straight through to
 *   `resolveEffectiveLiferayConnection` and, unused here otherwise, kept as a
 *   parameter rather than required internally so the caller's own instance -
 *   the one whose routes tree state this decision depends on - is what gets
 *   asked.
 * @param {object} persistence Ditto.
 * @param {{testConnection: Function}} liferayService Makes the probe call.
 * @returns {Promise<string|null>} A warning, or null when Basic is not in use
 *   or the credentials authenticated. `testConnection` can fail for reasons
 *   that have nothing to do with the credential - an unresolved URL, a
 *   refused connection, a timeout - and the SDK normalises all of them into
 *   an Error carrying `.response.status` when there was an HTTP response at
 *   all (the same field `ErrorHandler.isRetryableError` reads). Only 401 and
 *   403 mean the credential was sent and rejected; anything else says so
 *   without naming the variables, because asserting a cause this check has
 *   not established is the exact defect #950 exists to remove.
 */
async function verifyBasicCredentialAtStartup(
  oauthService,
  persistence,
  liferayService
) {
  let resolved;
  try {
    resolved = resolveEffectiveLiferayConnection({}, oauthService, persistence);
  } catch {
    // No authentication configured at all - a different, already-surfaced
    // problem than a Basic credential that is present but wrong.
    return null;
  }

  if (resolved.authMethod !== 'basic') return null;

  try {
    await liferayService.testConnection({ authMethod: 'basic' });
    return null;
  } catch (error) {
    const status = error?.response?.status;

    if (status === 401 || status === 403) {
      return (
        'Basic auth credentials did not authenticate - check LIFERAY_API_USERNAME ' +
        `and LIFERAY_API_PASSWORD: ${error.message}`
      );
    }

    // Not a rejected credential - the probe itself did not complete (DNS,
    // a refused connection, a timeout, or a URL the resolver could not
    // build). Deliberately does not name LIFERAY_API_USERNAME or
    // LIFERAY_API_PASSWORD: this check never got far enough to say anything
    // about them, and a warning that mentions them anyway reads as an
    // accusation this check has not earned.
    return (
      'Basic auth could not be verified at startup - the check itself did ' +
      `not complete (this is not a rejected credential): ${error.message}`
    );
  }
}

module.exports = {
  isUsableLiferayUrl,
  isValidAbsoluteUrl,
  tryBuildColocatedLiferayUrl,
  resolveEffectiveLiferayConnection,
  verifyBasicCredentialAtStartup,
};
