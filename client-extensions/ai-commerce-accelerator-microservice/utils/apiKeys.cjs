/**
 * Keeps a provider's API key from being sent to a different provider.
 *
 * The key is resolved generically - from the `ai-credentials` Liferay object or
 * the AI_API_KEY environment variable - and then handed to whichever provider
 * is configured. Nothing tied the two together, so an OpenAI key with
 * `provider: anthropic` was transmitted to api.anthropic.com in an x-api-key
 * header. That discloses a working credential to an unrelated third party, and
 * the only symptom is an authentication error that looks like a bad key.
 *
 * The check is prefix-based and deliberately one-sided: it blocks only when a
 * key is confidently attributable to a *different* provider. An unrecognised
 * key - a proxy, a gateway, Azure OpenAI, a self-hosted endpoint - is allowed
 * through, because refusing what we do not recognise would break working
 * configurations to guard against a mistake we cannot prove.
 */
const { providerLabel } = require('./providerCapabilities.cjs');

/**
 * Sentinel used by the demo/offline path; never a real credential.
 */
const MOCK_KEY = 'mock-sandbox';

/**
 * The credential family each provider authenticates with. Gemini and Nano
 * Banana are both Google endpoints and share a key.
 */
const PROVIDER_KEY_FAMILY = {
  anthropic: 'anthropic',
  gemini: 'google',
  nanobanana: 'google',
  openai: 'openai',
};

/**
 * The provider-specific environment variable to prefer over the generic
 * AI_API_KEY, so a correctly configured deployment never relies on the
 * ambiguous one.
 */
const PROVIDER_ENV_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  nanobanana: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
};

/**
 * Anthropic is tested before OpenAI: an Anthropic key is `sk-ant-...`, which
 * also satisfies OpenAI's `sk-` prefix.
 */
const KEY_PATTERNS = [
  { family: 'anthropic', pattern: /^sk-ant-/ },
  { family: 'google', pattern: /^AIza/ },
  { family: 'openai', pattern: /^sk-/ },
];

const FAMILY_LABELS = {
  anthropic: 'Anthropic',
  google: 'Google',
  openai: 'OpenAI',
};

/**
 * The credential family a key belongs to, or null when it is not recognised.
 */
function keyFamily(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key || key === MOCK_KEY) return null;

  const match = KEY_PATTERNS.find(({ pattern }) => pattern.test(key));
  return match ? match.family : null;
}

/**
 * The environment variable that should hold this provider's key.
 */
function providerEnvVar(provider) {
  return PROVIDER_ENV_VARS[String(provider || '').toLowerCase()] || null;
}

/**
 * Returns a message when the key plainly belongs to another provider, or null
 * when it matches, is unrecognised, or cannot be judged.
 *
 * The message never contains the key.
 */
function apiKeyIssue(provider, apiKey) {
  const target = String(provider || '').toLowerCase();
  const expected = PROVIDER_KEY_FAMILY[target];
  if (!expected) return null;

  const actual = keyFamily(apiKey);
  if (!actual || actual === expected) return null;

  const envVar = providerEnvVar(target);
  return `The configured API key looks like ${FAMILY_LABELS[actual]} credentials, but the provider is ${providerLabel(
    target
  )}. Sending it would disclose the key to the wrong service. Set ${envVar} or update the AI credentials for ${providerLabel(
    target
  )}.`;
}

/**
 * The provider name a key's prefix implies, or null when unrecognised.
 *
 * Lets an ambiguous AI_API_KEY be attributed rather than guessed at, so
 * startup can configure the matching provider instead of leaving it unset.
 */
function providerForKey(apiKey) {
  const family = keyFamily(apiKey);
  if (!family) return null;

  const match = Object.entries(PROVIDER_KEY_FAMILY).find(
    ([provider, value]) => value === family && provider !== 'nanobanana'
  );

  return match ? match[0] : null;
}

/**
 * Picks the credential to seed from the environment, and the provider it
 * belongs to.
 *
 * `lookup` is the accessor for environment configuration, passed in so the rule
 * can be tested without depending on how variables are resolved.
 *
 * A provider-specific variable wins over the generic AI_API_KEY, because the
 * caller *persists* the key it picks: preferring the ambiguous one meant an
 * unattributable credential outlived the variable it came from. Anthropic is
 * last among the specific keys because it cannot generate images, so a project
 * setting several is better defaulted to a provider covering data and media.
 * When only the generic key exists, its prefix is used to attribute it.
 */
function resolveCoreKey(lookup) {
  const read = (name) => {
    const value = lookup(name);
    const trimmed = String(value == null ? '' : value).trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  for (const [provider, envVar] of [
    ['openai', 'OPENAI_API_KEY'],
    ['gemini', 'GEMINI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
  ]) {
    const apiKey = read(envVar);
    if (apiKey) return { apiKey, provider, envVar };
  }

  const generic = read('AI_API_KEY');
  if (generic) {
    return {
      apiKey: generic,
      provider: providerForKey(generic),
      envVar: 'AI_API_KEY',
    };
  }

  return { apiKey: null, provider: null, envVar: null };
}

module.exports = {
  KEY_PATTERNS,
  MOCK_KEY,
  PROVIDER_ENV_VARS,
  PROVIDER_KEY_FAMILY,
  apiKeyIssue,
  keyFamily,
  providerEnvVar,
  providerForKey,
  resolveCoreKey,
};
