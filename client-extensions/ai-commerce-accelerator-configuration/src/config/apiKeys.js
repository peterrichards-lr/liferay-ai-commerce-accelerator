/**
 * Warns when an API key does not match the provider it would be sent to.
 *
 * The microservice enforces this too - aiService refuses before the key leaves
 * the process - so this exists to catch the mistake while it is being made,
 * rather than when a run fails. The key is only inspected locally; nothing is
 * sent anywhere to check it.
 *
 * The tables the check runs on are no longer mirrored from the microservice:
 * both sides read the same declaration through providerRegistry.js. Only the
 * wording differs, because the audiences differ - the operator here is pasting
 * a key into a form, not reading a startup log.
 */
import { providerLabel } from './providerCapabilities';
import {
  FAMILY_LABELS,
  KEY_PATTERNS,
  PROVIDER_ENV_VARS,
  PROVIDER_KEY_FAMILY,
} from './providerRegistry';

export { KEY_PATTERNS, PROVIDER_ENV_VARS, PROVIDER_KEY_FAMILY };

/**
 * Sentinel used by the demo/offline path; never a real credential.
 */
export const MOCK_KEY = 'mock-sandbox';

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
