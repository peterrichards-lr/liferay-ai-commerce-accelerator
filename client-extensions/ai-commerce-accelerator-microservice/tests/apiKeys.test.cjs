const {
  MOCK_KEY,
  apiKeyIssue,
  keyFamily,
  providerEnvVar,
  providerForKey,
  resolveCoreKey,
} = require('../utils/apiKeys.cjs');
const {
  DEFAULT_MODEL_OPTIONS,
  defaultModelForProvider,
} = require('../utils/modelCatalog.cjs');

const lookupFrom = (values) => (name) => values[name];

describe('api key provider matching', () => {
  describe('keyFamily', () => {
    it('recognises each provider by prefix', () => {
      expect(keyFamily('sk-ant-api03-xxxx')).toBe('anthropic');
      expect(keyFamily('AIzaSyXXXX')).toBe('google');
      expect(keyFamily('sk-proj-xxxx')).toBe('openai');
      expect(keyFamily('sk-xxxx')).toBe('openai');
    });

    it('does not mistake an Anthropic key for an OpenAI one', () => {
      // sk-ant- also satisfies OpenAI's sk- prefix, so ordering matters.
      expect(keyFamily('sk-ant-xxxx')).not.toBe('openai');
    });

    it('returns null for anything it does not recognise', () => {
      expect(keyFamily('my-gateway-token')).toBeNull();
      expect(keyFamily('')).toBeNull();
      expect(keyFamily(undefined)).toBeNull();
      expect(keyFamily(MOCK_KEY)).toBeNull();
    });
  });

  describe('apiKeyIssue', () => {
    it('blocks a key that belongs to another provider', () => {
      const issue = apiKeyIssue('anthropic', 'sk-proj-xxxx');
      expect(issue).toMatch(/looks like OpenAI credentials/);
      expect(issue).toMatch(/Anthropic Claude/);
      expect(issue).toMatch(/ANTHROPIC_API_KEY/);
    });

    it('never includes the key in the message', () => {
      const secret = 'sk-proj-SUPERSECRETVALUE';
      expect(apiKeyIssue('anthropic', secret)).not.toContain(secret);
      expect(apiKeyIssue('anthropic', secret)).not.toContain('SUPERSECRET');
    });

    it.each([
      ['openai', 'sk-proj-xxxx'],
      ['anthropic', 'sk-ant-xxxx'],
      ['gemini', 'AIzaXXXX'],
      ['nanobanana', 'AIzaXXXX'],
    ])('allows a matching key for %s', (provider, key) => {
      expect(apiKeyIssue(provider, key)).toBeNull();
    });

    it.each([
      ['anthropic', 'sk-xxxx'],
      ['openai', 'sk-ant-xxxx'],
      ['gemini', 'sk-xxxx'],
      ['nanobanana', 'sk-ant-xxxx'],
    ])('blocks a mismatched key for %s', (provider, key) => {
      expect(apiKeyIssue(provider, key)).not.toBeNull();
    });

    it('allows an unrecognised key rather than breaking a proxy setup', () => {
      // A gateway, Azure OpenAI or a self-hosted endpoint will not match any
      // prefix. Refusing those would break working configurations.
      expect(apiKeyIssue('openai', 'my-gateway-token')).toBeNull();
    });

    it('allows the demo sandbox sentinel', () => {
      expect(apiKeyIssue('anthropic', MOCK_KEY)).toBeNull();
    });

    it('stays silent when either side is missing', () => {
      expect(apiKeyIssue('', 'sk-xxxx')).toBeNull();
      expect(apiKeyIssue('anthropic', '')).toBeNull();
      expect(apiKeyIssue(undefined, undefined)).toBeNull();
    });

    it('stays silent for a provider it does not know', () => {
      expect(apiKeyIssue('some-future-provider', 'sk-xxxx')).toBeNull();
    });
  });

  describe('providerEnvVar', () => {
    it('maps each provider to its variable', () => {
      expect(providerEnvVar('openai')).toBe('OPENAI_API_KEY');
      expect(providerEnvVar('anthropic')).toBe('ANTHROPIC_API_KEY');
      expect(providerEnvVar('gemini')).toBe('GEMINI_API_KEY');
      // Nano Banana is a Google endpoint and shares the Gemini credential.
      expect(providerEnvVar('nanobanana')).toBe('GEMINI_API_KEY');
    });

    it('returns null for an unknown provider', () => {
      expect(providerEnvVar('nope')).toBeNull();
    });
  });

  describe('resolveCoreKey', () => {
    it('prefers a provider-specific key over the generic one', () => {
      // syncEnvironmentKeys persists what this picks, so preferring the
      // ambiguous AI_API_KEY meant an unattributable credential outlived the
      // variable it came from.
      const resolved = resolveCoreKey(
        lookupFrom({
          AI_API_KEY: 'sk-generic',
          ANTHROPIC_API_KEY: 'sk-ant-specific',
        })
      );

      expect(resolved.apiKey).toBe('sk-ant-specific');
      expect(resolved.provider).toBe('anthropic');
    });

    it('prefers OpenAI over Anthropic when both are set', () => {
      // Anthropic cannot generate images, so a project setting several keys is
      // better defaulted to a provider covering data and media. See #577.
      const resolved = resolveCoreKey(
        lookupFrom({
          OPENAI_API_KEY: 'sk-proj-x',
          ANTHROPIC_API_KEY: 'sk-ant-x',
        })
      );

      expect(resolved.provider).toBe('openai');
    });

    it('attributes a generic key by its prefix when it is all there is', () => {
      const resolved = resolveCoreKey(
        lookupFrom({ AI_API_KEY: 'sk-ant-only' })
      );

      expect(resolved.apiKey).toBe('sk-ant-only');
      expect(resolved.provider).toBe('anthropic');
    });

    it('leaves the provider unset when a generic key cannot be attributed', () => {
      // A gateway or self-hosted token tells us nothing, and guessing would be
      // worse than letting the operator choose.
      const resolved = resolveCoreKey(
        lookupFrom({ AI_API_KEY: 'my-gateway-token' })
      );

      expect(resolved.apiKey).toBe('my-gateway-token');
      expect(resolved.provider).toBeNull();
    });

    it('ignores blank and whitespace-only values', () => {
      const resolved = resolveCoreKey(
        lookupFrom({ OPENAI_API_KEY: '   ', ANTHROPIC_API_KEY: 'sk-ant-x' })
      );

      expect(resolved.provider).toBe('anthropic');
    });

    it('trims the key it returns', () => {
      expect(
        resolveCoreKey(lookupFrom({ OPENAI_API_KEY: '  sk-proj-x  ' })).apiKey
      ).toBe('sk-proj-x');
    });

    it('reports nothing when no key is set', () => {
      expect(resolveCoreKey(lookupFrom({}))).toEqual({
        apiKey: null,
        provider: null,
        envVar: null,
      });
    });

    it('resolves to a provider that has a usable default model', () => {
      // The seeded ai-config previously used a ternary with no anthropic
      // branch, so detecting Anthropic configured gemini-1.5-flash - a pairing
      // aiService now rejects, and a model no longer in the shipped list.
      for (const envVar of [
        'OPENAI_API_KEY',
        'GEMINI_API_KEY',
        'ANTHROPIC_API_KEY',
      ]) {
        const { provider } = resolveCoreKey(
          lookupFrom({ [envVar]: 'sk-ant-x' })
        );
        const model = defaultModelForProvider(DEFAULT_MODEL_OPTIONS, provider);

        expect(model).toBeTruthy();
        expect(
          DEFAULT_MODEL_OPTIONS.find((option) => option.value === model)
            .provider
        ).toBe(provider);
      }
    });
  });

  describe('providerForKey', () => {
    it('maps a recognised key to its provider', () => {
      expect(providerForKey('sk-ant-x')).toBe('anthropic');
      expect(providerForKey('AIzaX')).toBe('gemini');
      expect(providerForKey('sk-proj-x')).toBe('openai');
    });

    it('returns null for an unrecognised key', () => {
      expect(providerForKey('gateway-token')).toBeNull();
    });
  });
});
