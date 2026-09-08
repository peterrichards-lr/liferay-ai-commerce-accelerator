const AnthropicProvider = require('../services/ai-providers/anthropicProvider.cjs');

function buildProvider(createImpl, { capabilities } = {}) {
  const provider = new AnthropicProvider({
    logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
  });

  const create = vi.fn(createImpl);
  const retrieve = vi.fn().mockResolvedValue({
    capabilities: capabilities ?? { structured_outputs: { supported: true } },
  });

  provider._getClient = vi.fn().mockResolvedValue({
    messages: { create },
    models: { list: vi.fn().mockResolvedValue({ data: [] }), retrieve },
  });

  return { create, provider, retrieve };
}

// A generation schema small enough to assert on, with the locale map that a
// whole entity body was once nested inside. See #633.
const WAREHOUSE_SCHEMA = {
  properties: {
    warehouses: {
      items: {
        properties: {
          latitude: { maximum: 90, minimum: -90, type: 'number' },
          name: { additionalProperties: { type: 'string' }, type: 'object' },
        },
        required: ['name'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['warehouses'],
  type: 'object',
};

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

    it('sends the schema as output_config.format rather than as prose', async () => {
      const { provider, create } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      await provider.generateJSON(
        'warehouse',
        'p',
        { credentials: { apiKey: 'sk-test' }, languages: ['en-US', 'es-ES'] },
        WAREHOUSE_SCHEMA
      );

      const request = create.mock.calls[0][0];

      // output_config.format, not the deprecated output_format parameter.
      expect(request.output_format).toBeUndefined();
      expect(request.output_config.format.type).toBe('json_schema');

      const items =
        request.output_config.format.schema.properties.warehouses.items;

      expect(Object.keys(items.properties.name.properties)).toEqual([
        'en_US',
        'es_ES',
      ]);
      expect(items.properties.name.additionalProperties).toBe(false);
      // Rejected by the structured-output subset; ajv still enforces it.
      expect(items.properties.latitude.minimum).toBeUndefined();

      expect(request.system).not.toContain('conform to the following schema');
    });

    it('describes the schema in the prompt when it cannot be projected', async () => {
      const { provider, create } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      // An object whose keys are not described cannot be expressed: every
      // object in a structured output must be closed.
      await provider.generateJSON(
        'account',
        'p',
        { credentials: { apiKey: 'sk-test' } },
        { properties: { extras: { type: 'object' } }, required: ['extras'] }
      );

      const request = create.mock.calls[0][0];

      expect(request.output_config).toBeUndefined();
      expect(request.system).toContain('conform to the following schema');
    });

    it('names the locale keys in the prose fallback', async () => {
      const { provider, create } = buildProvider(
        async () => textResponse('{"ok":true}'),
        { capabilities: { structured_outputs: { supported: false } } }
      );

      await provider.generateJSON(
        'warehouse',
        'p',
        { credentials: { apiKey: 'sk-test' }, languages: ['en-US', 'fr-FR'] },
        WAREHOUSE_SCHEMA
      );

      const { system } = create.mock.calls[0][0];

      expect(system).toContain('conform to the following schema');
      expect(system).toContain('"fr_FR"');
      // The prose copy keeps the value constraints, which only the model reads.
      expect(system).toContain('"minimum":-90');
    });

    it('withholds structured output when the model says it cannot do it', async () => {
      const { provider, create, retrieve } = buildProvider(
        async () => textResponse('{"ok":true}'),
        { capabilities: { structured_outputs: { supported: false } } }
      );

      await provider.generateJSON(
        'warehouse',
        'p',
        { credentials: { apiKey: 'sk-test' } },
        WAREHOUSE_SCHEMA
      );

      expect(retrieve).toHaveBeenCalledWith('claude-opus-5');
      expect(create.mock.calls[0][0].output_config).toBeUndefined();
    });

    it('asks the models endpoint once per model', async () => {
      const { provider, retrieve } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      const options = { credentials: { apiKey: 'sk-test' } };
      await provider.generateJSON('warehouse', 'p', options, WAREHOUSE_SCHEMA);
      await provider.generateJSON('warehouse', 'p', options, WAREHOUSE_SCHEMA);

      expect(retrieve).toHaveBeenCalledTimes(1);
    });

    it('sends the schema anyway when the capability lookup fails', async () => {
      const { provider, create } = buildProvider(async () =>
        textResponse('{"ok":true}')
      );

      provider._getClient = vi.fn().mockResolvedValue({
        messages: { create },
        models: {
          retrieve: vi.fn().mockRejectedValue(new Error('network down')),
        },
      });

      await provider.generateJSON(
        'warehouse',
        'p',
        { credentials: { apiKey: 'sk-test' } },
        WAREHOUSE_SCHEMA
      );

      expect(create.mock.calls[0][0].output_config).toBeDefined();
    });

    it('degrades to the prose path when the schema is rejected', async () => {
      let attempt = 0;
      const { provider, create } = buildProvider(async () => {
        attempt += 1;
        if (attempt === 1) {
          const error = new Error(
            'output_config.format: unsupported keyword "minItems"'
          );
          error.status = 400;
          throw error;
        }
        return textResponse('{"ok":true}');
      });

      const result = await provider.generateJSON(
        'warehouse',
        'p',
        { credentials: { apiKey: 'sk-test' } },
        WAREHOUSE_SCHEMA
      );

      expect(result).toEqual({ ok: true });
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[1][0].output_config).toBeUndefined();
      expect(create.mock.calls[1][0].system).toContain(
        'conform to the following schema'
      );
    });

    it('does not retry an error that is not about the schema', async () => {
      const { provider, create } = buildProvider(async () => {
        const error = new Error('rate limit exceeded');
        error.status = 429;
        throw error;
      });

      await expect(
        provider.generateJSON(
          'warehouse',
          'p',
          { credentials: { apiKey: 'sk-test' } },
          WAREHOUSE_SCHEMA
        )
      ).rejects.toThrow(/rate limit/);

      expect(create).toHaveBeenCalledTimes(1);
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
