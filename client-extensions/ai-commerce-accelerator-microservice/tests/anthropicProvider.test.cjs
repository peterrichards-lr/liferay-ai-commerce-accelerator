const AnthropicProvider = require('../services/ai-providers/anthropicProvider.cjs');

function buildProvider(createImpl) {
  const provider = new AnthropicProvider({
    logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  });

  const create = vi.fn(createImpl);
  provider._getClient = vi.fn().mockResolvedValue({
    messages: { create },
    models: { list: vi.fn().mockResolvedValue({ data: [] }) },
  });

  return { provider, create };
}

const textResponse = (text, extra = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  ...extra,
});

describe('AnthropicProvider', () => {
  describe('generateJSON', () => {
    it('parses the JSON returned in the text block', async () => {
      const { provider } = buildProvider(async () =>
        textResponse('{"products":[{"name":"Helmet"}]}')
      );

      const result = await provider.generateJSON(
        'product',
        'Generate products',
        { credentials: { apiKey: 'sk-test' } },
        null
      );

      expect(result).toEqual({ products: [{ name: 'Helmet' }] });
    });

    it('defaults to claude-opus-5', async () => {
      const { provider, create } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      await provider.generateJSON('product', 'p', {
        credentials: { apiKey: 'sk-test' },
      });

      expect(create.mock.calls[0][0].model).toBe('claude-opus-5');
    });

    it('never sends sampling parameters, which this model family rejects', async () => {
      const { provider, create } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      await provider.generateJSON('product', 'p', {
        credentials: { apiKey: 'sk-test' },
        temperature: 0.7,
      });

      const request = create.mock.calls[0][0];
      expect(request.temperature).toBeUndefined();
      expect(request.top_p).toBeUndefined();
      expect(request.top_k).toBeUndefined();
    });

    it('falls back to the default when handed a non-Claude model', async () => {
      const { provider, create } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      // The model list is shared across providers, so a session switched from
      // OpenAI can arrive carrying a GPT model. That would 404.
      await provider.generateJSON('product', 'p', {
        credentials: { apiKey: 'sk-test' },
        model: 'gpt-4o-mini',
      });

      expect(create.mock.calls[0][0].model).toBe('claude-opus-5');
    });

    it('honours an explicitly selected Claude model', async () => {
      const { provider, create } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      await provider.generateJSON('product', 'p', {
        credentials: { apiKey: 'sk-test' },
        model: 'claude-haiku-4-5',
      });

      expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');
    });

    it('puts the schema in the system prompt when one is supplied', async () => {
      const { provider, create } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      await provider.generateJSON(
        'account',
        'p',
        { credentials: { apiKey: 'sk-test' } },
        { type: 'object', properties: { name: { type: 'string' } } }
      );

      expect(create.mock.calls[0][0].system).toContain(
        'conform to the following schema'
      );
      expect(create.mock.calls[0][0].system).toContain('"name"');
    });

    it('ignores thinking blocks and reads only the text', async () => {
      const { provider } = buildProvider(async () => ({
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: 'considering the catalogue' },
          { type: 'text', text: '{"ok":true}' },
        ],
      }));

      const result = await provider.generateJSON('product', 'p', {
        credentials: { apiKey: 'sk-test' },
      });

      expect(result).toEqual({ ok: true });
    });

    it('reports truncation distinctly from malformed output', async () => {
      const { provider } = buildProvider(async () => ({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"products":[' }],
      }));

      await expect(
        provider.generateJSON('product', 'p', {
          credentials: { apiKey: 'sk-test' },
        })
      ).rejects.toThrow(/truncated/i);
    });

    it('surfaces a refusal with its category', async () => {
      const { provider } = buildProvider(async () => ({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber' },
        content: [],
      }));

      await expect(
        provider.generateJSON('product', 'p', {
          credentials: { apiKey: 'sk-test' },
        })
      ).rejects.toThrow(/declined.*cyber/i);
    });

    it('rejects unparseable content', async () => {
      const { provider } = buildProvider(async () =>
        textResponse('Sorry, here is some prose instead.')
      );

      await expect(
        provider.generateJSON('product', 'p', {
          credentials: { apiKey: 'sk-test' },
        })
      ).rejects.toThrow(/invalid or unparseable JSON/i);
    });
  });

  describe('generateImage', () => {
    it('throws directing the user to a dedicated media provider', async () => {
      const provider = new AnthropicProvider({ logger: {} });

      await expect(provider.generateImage({}, {})).rejects.toThrow(
        /Claude does not support image generation.*OpenAI DALL-E or NanoBanana/s
      );
    });
  });

  describe('validateCredentials', () => {
    it('returns true when the key lists models', async () => {
      const { provider } = buildProvider(async () => textResponse('{}'));
      await expect(
        provider.validateCredentials({ apiKey: 'sk-test' })
      ).resolves.toBe(true);
    });

    it('returns false rather than throwing on a bad key', async () => {
      const provider = new AnthropicProvider({ logger: {} });
      provider._getClient = vi.fn().mockRejectedValue(new Error('401'));

      await expect(
        provider.validateCredentials({ apiKey: 'bad' })
      ).resolves.toBe(false);
    });

    it('requires an api key', async () => {
      const provider = new AnthropicProvider({ logger: {} });
      await expect(provider._getClient({})).rejects.toThrow(/API key missing/i);
    });
  });
});
