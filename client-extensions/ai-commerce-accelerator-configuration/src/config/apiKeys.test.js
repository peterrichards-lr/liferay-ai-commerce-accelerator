import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { MOCK_KEY, apiKeyIssue, keyFamily, providerEnvVar } from './apiKeys';

const require = createRequire(import.meta.url);

describe('apiKeys', () => {
  it('warns when the key belongs to another provider', () => {
    expect(apiKeyIssue('anthropic', 'sk-proj-xxxx')).toMatch(
      /looks like OpenAI credentials/
    );
  });

  it('never includes the key in the message', () => {
    const secret = 'sk-proj-SUPERSECRETVALUE';
    expect(apiKeyIssue('anthropic', secret)).not.toContain('SUPERSECRET');
  });

  it.each([
    ['openai', 'sk-proj-xxxx'],
    ['anthropic', 'sk-ant-xxxx'],
    ['gemini', 'AIzaXXXX'],
  ])('stays silent for a matching %s key', (provider, key) => {
    expect(apiKeyIssue(provider, key)).toBeNull();
  });

  it('stays silent for a key it cannot identify', () => {
    // A gateway or self-hosted endpoint cannot be judged either way, and
    // warning about it would be noise on a working configuration.
    expect(apiKeyIssue('openai', 'my-gateway-token')).toBeNull();
  });

  it('stays silent for the demo sandbox sentinel', () => {
    expect(apiKeyIssue('anthropic', MOCK_KEY)).toBeNull();
  });

  it('does not mistake an Anthropic key for an OpenAI one', () => {
    expect(keyFamily('sk-ant-xxxx')).toBe('anthropic');
  });

  it('behaves identically to the microservice', () => {
    // Separate packages with different module systems, so the shared behaviour
    // is asserted rather than imported.
    const microservice = require('../../../ai-commerce-accelerator-microservice/utils/apiKeys.cjs');

    for (const key of [
      'sk-ant-x',
      'AIzaX',
      'sk-proj-x',
      'sk-x',
      'gateway-token',
      MOCK_KEY,
      '',
    ]) {
      expect(keyFamily(key)).toBe(microservice.keyFamily(key));
    }

    for (const provider of ['openai', 'anthropic', 'gemini', 'nanobanana']) {
      expect(providerEnvVar(provider)).toBe(
        microservice.providerEnvVar(provider)
      );

      for (const key of ['sk-ant-x', 'AIzaX', 'sk-proj-x', 'gateway-token']) {
        // The wording differs by audience; whether it fires must not.
        expect(apiKeyIssue(provider, key) === null).toBe(
          microservice.apiKeyIssue(provider, key) === null
        );
      }
    }
  });
});
