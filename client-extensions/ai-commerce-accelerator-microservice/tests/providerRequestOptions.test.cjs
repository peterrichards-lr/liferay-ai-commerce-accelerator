const AnthropicProvider = require('../services/ai-providers/anthropicProvider.cjs');
const GeminiProvider = require('../services/ai-providers/geminiProvider.cjs');
const OpenAIProvider = require('../services/ai-providers/openaiProvider.cjs');
const { DEFAULT_MAX_TOKENS } = require('../utils/aiRequestOptions.cjs');

/**
 * The timeout and the output cap reach the provider's own call, per provider.
 *
 * `aiRequestOptions.test.cjs` covers what the helpers resolve; this covers
 * whether anybody calls them. That distinction is the whole history of these
 * two settings: #762 found a timeout that was resolved, returned on the
 * runtime object and spread into the provider's options, which neither
 * provider read; #823 found a cap written in two places and reconciled by
 * comparing against a magic value; and #861 found that Gemini was left out of
 * the fix for both, so the panel's timeout was a no-op there and the cap was
 * never sent at all.
 *
 * Four rounds of "the panel writes it and the service resolves it" proved
 * nothing, so these assert the number as the SDK was handed it.
 */
const TIMEOUT_MS = 12345;
const MAX_TOKENS = 4000;

const OPTIONS = {
  credentials: { apiKey: 'sk-test' },
  maxTokens: MAX_TOKENS,
  requestTimeoutMs: TIMEOUT_MS,
};

describe('AnthropicProvider sends the configured request options', () => {
  const buildProvider = () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"ok":true}' }],
      stop_reason: 'end_turn',
    });
    const provider = new AnthropicProvider({
      logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    provider._getClient = vi.fn().mockResolvedValue({
      messages: { create },
      models: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        retrieve: vi.fn().mockResolvedValue({
          capabilities: { structured_outputs: { supported: true } },
        }),
      },
    });

    return { create, provider };
  };

  it('puts the timeout on the request and the cap in the body', async () => {
    const { create, provider } = buildProvider();

    await provider.generateJSON('warehouse', 'prompt', OPTIONS, null);

    const [body, perRequest] = create.mock.calls[0];
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(perRequest).toEqual({ timeout: TIMEOUT_MS });
  });

  it('falls back to the one default when nothing is configured', async () => {
    const { create, provider } = buildProvider();

    await provider.generateJSON(
      'warehouse',
      'prompt',
      { credentials: { apiKey: 'sk-test' } },
      null
    );

    const [body, perRequest] = create.mock.calls[0];
    expect(body.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(perRequest).toEqual({});
  });
});

describe('OpenAIProvider sends the configured request options', () => {
  const buildProvider = () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
      usage: {},
    });
    const provider = new OpenAIProvider({
      logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    provider._getClient = vi.fn().mockResolvedValue({
      chat: { completions: { create } },
    });

    return { create, provider };
  };

  it('puts the timeout on the request and the cap in the body', async () => {
    const { create, provider } = buildProvider();

    await provider.generateJSON('warehouse', 'prompt', OPTIONS, null);

    const [body, perRequest] = create.mock.calls[0];
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(perRequest).toEqual({ timeout: TIMEOUT_MS });
  });

  it('falls back to the one default when nothing is configured', async () => {
    const { create, provider } = buildProvider();

    await provider.generateJSON(
      'warehouse',
      'prompt',
      { credentials: { apiKey: 'sk-test' } },
      null
    );

    const [body, perRequest] = create.mock.calls[0];
    expect(body.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(perRequest).toEqual({});
  });
});

describe('GeminiProvider sends the configured request options', () => {
  const buildProvider = () => {
    const generateContent = vi.fn().mockResolvedValue({
      response: { text: () => '{"ok":true}' },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    const provider = new GeminiProvider({
      logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    provider._getClient = vi.fn().mockResolvedValue({ getGenerativeModel });

    return { generateContent, getGenerativeModel, provider };
  };

  it('puts the timeout on the request and the cap in the generation config', async () => {
    const { generateContent, getGenerativeModel, provider } = buildProvider();

    await provider.generateJSON('warehouse', 'prompt', OPTIONS, null);

    const [{ generationConfig }] = getGenerativeModel.mock.calls[0];
    expect(generationConfig.maxOutputTokens).toBe(MAX_TOKENS);

    const [, perRequest] = generateContent.mock.calls[0];
    expect(perRequest).toEqual({ timeout: TIMEOUT_MS });
  });

  it('falls back to the one default when nothing is configured', async () => {
    const { generateContent, getGenerativeModel, provider } = buildProvider();

    await provider.generateJSON(
      'warehouse',
      'prompt',
      { credentials: { apiKey: 'key' } },
      null
    );

    const [{ generationConfig }] = getGenerativeModel.mock.calls[0];
    expect(generationConfig.maxOutputTokens).toBe(DEFAULT_MAX_TOKENS);

    const [, perRequest] = generateContent.mock.calls[0];
    expect(perRequest).toEqual({});
  });

  // The schema retry builds a second request from scratch, which is where a
  // per-request setting is most easily dropped.
  it('keeps both when the responseSchema is rejected and the call is retried', async () => {
    const { generateContent, getGenerativeModel, provider } = buildProvider();
    const rejection = new Error(
      'Invalid JSON payload received. Unknown name "responseSchema"'
    );
    rejection.status = 400;
    generateContent.mockRejectedValueOnce(rejection);

    const schema = {
      properties: {
        warehouses: {
          items: {
            properties: { name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
          type: 'array',
        },
      },
      required: ['warehouses'],
      type: 'object',
    };

    await provider.generateJSON('warehouse', 'prompt', OPTIONS, schema);

    expect(generateContent).toHaveBeenCalledTimes(2);
    getGenerativeModel.mock.calls.forEach(([{ generationConfig }]) => {
      expect(generationConfig.maxOutputTokens).toBe(MAX_TOKENS);
    });
    generateContent.mock.calls.forEach(([, perRequest]) => {
      expect(perRequest).toEqual({ timeout: TIMEOUT_MS });
    });
  });
});
