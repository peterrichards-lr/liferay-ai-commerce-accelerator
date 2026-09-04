/**
 * Warns when an API key does not match the provider it would be sent to.
 *
 * The microservice enforces this too - aiService refuses before the key leaves
 * the process - so this exists to catch the mistake while it is being made,
 * rather than when a run fails. The key is only inspected locally; nothing is
 * sent anywhere to check it.
 *
 * Kept deliberately parallel to
 * ai-commerce-accelerator-microservice/utils/apiKeys.cjs. The two cannot share
 * a module because they are separate packages with different module systems;
 * apiKeys.test.js asserts they stay in step.
 */
import { providerLabel } from './providerCapabilities';

/**
 * Sentinel used by the demo/offline path; never a real credential.
 */
export const MOCK_KEY = 'mock-sandbox';

export const PROVIDER_KEY_FAMILY = {
  anthropic: 'anthropic',
  gemini: 'google',
  nanobanana: 'google',
  openai: 'openai',
};

export const PROVIDER_ENV_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  nanobanana: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
};

/**
 * Anthropic is tested before OpenAI: an Anthropic key is `sk-ant-...`, which
 * also satisfies OpenAI's `sk-` prefix.
 */
export const KEY_PATTERNS = [
  { family: 'anthropic', pattern: /^sk-ant-/ },
  { family: 'google', pattern: /^AIza/ },
  { family: 'openai', pattern: /^sk-/ },
];

const FAMILY_LABELS = {
  anthropic: 'Anthropic',
  google: 'Google',
  openai: 'OpenAI',
};

export function keyFamily(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key || key === MOCK_KEY) return null;

  const match = KEY_PATTERNS.find(({ pattern }) => pattern.test(key));
  return match ? match.family : null;
}

export function providerEnvVar(provider) {
  return PROVIDER_ENV_VARS[String(provider || '').toLowerCase()] || null;
}

/**
 * Returns a message when the key plainly belongs to another provider, or null
 * when it matches, is unrecognised, or cannot be judged.
 *
 * The message never contains the key.
 */
export function apiKeyIssue(provider, apiKey) {
  const target = String(provider || '').toLowerCase();
  const expected = PROVIDER_KEY_FAMILY[target];
  if (!expected) return null;

  const actual = keyFamily(apiKey);
  if (!actual || actual === expected) return null;

  return `This key looks like ${FAMILY_LABELS[actual]} credentials, but the provider is ${providerLabel(
    target
  )}. Saving it would send the key to the wrong service. Paste a ${providerLabel(
    target
  )} key, or change the provider.`;
}
