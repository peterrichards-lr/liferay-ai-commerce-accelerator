const { createERC } = require('./misc.cjs');
const { ENV, ERC_PREFIX } = require('./constants.cjs');
const { isValidAbsoluteUrl } = require('./liferayEnv.cjs');

/**
 * Where AICA reads its own configuration, as opposed to where it writes data.
 *
 * The two were one connection, which is correct when they are the same
 * instance and wrong whenever they are not - the supported "local microservice,
 * remote target" topology. Against a target with no `c_aicaconfiguration`
 * object every AI setting fell through to a literal with no way to override it:
 * a `requestTimeoutMs` of 300000 set in the panel had no effect and the run
 * died three times at 60s. See #824.
 *
 * A connection rather than a URL override, because #903's first correction
 * settled the credential model: each connection carries a client id and a
 * secret. An OAuth external reference code cannot work here, since resolving
 * one goes through `lxcConfig.oauthApplication(erc)`, which reads Liferay's
 * routes tree - and in the split topology there is no tree, so the model fails
 * in precisely the case this exists to fix.
 */

/** The single request-body field naming a configuration source. */
const CONFIGURATION_SOURCE_FIELD = 'configSource';

const SOURCE = Object.freeze({
  SAME_AS_TARGET: 'same-as-target',
  STATED: 'request',
  ENV: 'env:AICA_CONFIG_SOURCE_URL',
});

/**
 * The layer below the request, and above nothing.
 *
 * Request first because on a shared deployment ENV is a single value for every
 * user of the server - the same ordering `getRuntimeAIConfig` uses for the AI
 * settings themselves, and for the same reason. It exists so a CLI or a
 * scripted run can name a configuration source without a client secret
 * reaching shell history or a process listing.
 */
function statedInEnvironment() {
  const liferayUrl = trimmed(ENV.AICA_CONFIG_SOURCE_URL);

  if (!liferayUrl) return null;

  return {
    liferayUrl,
    clientId: trimmed(ENV.AICA_CONFIG_SOURCE_CLIENT_ID) || undefined,
    clientSecret: trimmed(ENV.AICA_CONFIG_SOURCE_CLIENT_SECRET) || undefined,
  };
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function configurationSourceError(message, userMessage, detail) {
  const error = new Error(message);
  error.name = 'ConfigurationSourceError';
  error.statusCode = 400;
  error.operation = 'configuration-source-resolution';
  error.userMessage = userMessage;
  error.errorReference = createERC(ERC_PREFIX.ERROR);
  error.problem = { status: 'CONFIGURATION_ERROR', detail };
  return error;
}

/**
 * A read against the configuration source did not complete.
 *
 * Distinct from the configuration source holding nothing, which is an answer.
 * This is the absence of an answer, and the whole point of #824 is that it must
 * not be turned into a literal: a value AICA invented and a value the operator
 * set have to be told apart, or a panel setting can appear to work while doing
 * nothing.
 */
function configurationUnavailable(cause, description) {
  const where = description?.sameAsTarget
    ? `the target instance (${description?.liferayUrl})`
    : `the configuration source (${description?.liferayUrl})`;

  const error = new Error(
    `AICA configuration could not be read from ${where}: ${cause?.message || cause}`
  );
  error.name = 'ConfigurationSourceUnavailableError';
  error.statusCode = 502;
  error.operation = 'configuration-source-read';
  error.cause = cause;
  error.configurationSource = description;
  error.userMessage =
    `AICA could not read its configuration from ${where}. ` +
    'No default has been substituted, because a setting that silently falls ' +
    'back to a built-in value cannot be corrected. Check that instance is ' +
    'reachable and that the credentials for it are correct.';
  error.errorReference = cause?.errorReference || createERC(ERC_PREFIX.ERROR);
  error.problem = {
    status: 'CONFIGURATION_UNAVAILABLE',
    detail: `The configuration read against ${where} did not complete.`,
  };
  return error;
}

/**
 * The connection AICA should read its configuration over.
 *
 * Absent, blank, or naming the same host as the target, the answer is the
 * target connection itself - today's behaviour, and the default the ninety-nine
 * runs in a hundred with one Liferay never have to think about.
 *
 * Stated and different, it must be complete. Reusing the target's credentials
 * against another instance is refused rather than warned about: on a connection
 * whose entire reason to exist is being a different instance, credentials
 * minted for the target are not a fallback, they are the wrong credentials.
 */
function resolveConfigurationSource(targetConfig = {}) {
  const fromRequest = targetConfig?.[CONFIGURATION_SOURCE_FIELD];
  const stated = trimmed(fromRequest?.liferayUrl)
    ? fromRequest
    : statedInEnvironment();
  const statedSource = trimmed(fromRequest?.liferayUrl)
    ? SOURCE.STATED
    : SOURCE.ENV;
  const liferayUrl = trimmed(stated?.liferayUrl);

  if (!stated || !liferayUrl) {
    return {
      connection: targetConfig,
      liferayUrl: targetConfig?.liferayUrl || null,
      sameAsTarget: true,
      source: SOURCE.SAME_AS_TARGET,
    };
  }

  if (!isValidAbsoluteUrl(liferayUrl)) {
    throw configurationSourceError(
      `Configuration source URL is not a valid absolute URL: ${liferayUrl}`,
      'The configuration source needs a full URL, such as http://localhost:8080.',
      'configSource.liferayUrl must be an absolute http or https URL.'
    );
  }

  const clientId = trimmed(stated.clientId);
  const clientSecret = trimmed(stated.clientSecret);
  const sameHost =
    !!targetConfig?.liferayUrl &&
    hostOf(liferayUrl) === hostOf(targetConfig.liferayUrl);

  // Named, but naming the instance already being written to and adding no
  // credentials of its own. That is same-as-target spelled out, and reporting
  // it as a distinct source would put a second chip on the screen saying
  // nothing.
  if (sameHost && !clientId && !clientSecret) {
    return {
      connection: targetConfig,
      liferayUrl: targetConfig.liferayUrl,
      sameAsTarget: true,
      source: SOURCE.SAME_AS_TARGET,
    };
  }

  if (!sameHost && !(clientId && clientSecret)) {
    throw configurationSourceError(
      'A configuration source on a different instance needs its own client id and secret',
      `The configuration source (${liferayUrl}) is a different instance from the ` +
        'data target, so it needs its own Client ID and Client Secret. The ' +
        'target credentials are not valid there.',
      'configSource.clientId and configSource.clientSecret are both required ' +
        'when configSource.liferayUrl names a different host from liferayUrl.'
    );
  }

  return {
    connection: {
      liferayUrl,
      clientId: clientId || targetConfig?.clientId,
      clientSecret: clientSecret || targetConfig?.clientSecret,
      authMethod: stated.authMethod || undefined,
      correlationId: targetConfig?.correlationId,
    },
    liferayUrl,
    sameAsTarget: false,
    source: statedSource,
  };
}

/**
 * What can be said about the configuration source out loud - on an API
 * response, in a log line, in an error. The secret is not in it, and there is
 * no parameter that puts it there.
 */
function describeConfigurationSource(targetConfig = {}) {
  let resolved;

  try {
    resolved = resolveConfigurationSource(targetConfig);
  } catch (error) {
    return {
      liferayUrl: trimmed(
        targetConfig?.[CONFIGURATION_SOURCE_FIELD]?.liferayUrl
      ),
      sameAsTarget: false,
      source: SOURCE.STATED,
      error: error.message,
    };
  }

  return {
    liferayUrl: resolved.liferayUrl,
    clientId: resolved.connection?.clientId || null,
    sameAsTarget: resolved.sameAsTarget,
    source: resolved.source,
  };
}

/**
 * The shape a request may state, with anything else dropped.
 *
 * Whitelisted for the same reason the frontend payload is: a second credential
 * set behind a wholesale spread doubles what #820 exposed, and this is the
 * server-side half of that guarantee. Returns undefined when nothing usable was
 * supplied, so a request that never mentions a configuration source leaves the
 * target connection to answer for configuration exactly as it does today.
 */
function normalizeConfigurationSource(raw) {
  const stated = typeof raw === 'string' ? tryParse(raw) : raw;

  if (!stated || typeof stated !== 'object') return undefined;

  const liferayUrl = trimmed(stated.liferayUrl);

  if (!liferayUrl) return undefined;

  const normalized = { liferayUrl };
  const clientId = trimmed(stated.clientId);
  const clientSecret = trimmed(stated.clientSecret);

  if (clientId) normalized.clientId = clientId;
  if (clientSecret) normalized.clientSecret = clientSecret;

  return normalized;
}

function tryParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

module.exports = {
  CONFIGURATION_SOURCE_FIELD,
  CONFIGURATION_SOURCE: SOURCE,
  configurationUnavailable,
  describeConfigurationSource,
  normalizeConfigurationSource,
  resolveConfigurationSource,
};
