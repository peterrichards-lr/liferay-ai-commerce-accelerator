const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const BaseAIProvider = require('./baseProvider.cjs');
const { tryParseJSON } = require('../../utils/misc.cjs');

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 16384;
const MAX_CLIENTS = 10;

const IMAGE_UNSUPPORTED_MESSAGE =
  'Claude does not support image generation. Please configure a dedicated Media Provider (OpenAI DALL-E or NanoBanana).';

class AnthropicProvider extends BaseAIProvider {
  constructor(ctx) {
    super(ctx);
    this.clientRegistry = new Map();
  }

  async _getClient(credentials) {
    const apiKey = credentials?.apiKey;
    if (!apiKey) throw new Error('Anthropic API key missing');

    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const now = Date.now();

    if (this.clientRegistry.has(hash)) {
      const entry = this.clientRegistry.get(hash);
      entry.lastAccessed = now;
      return entry.client;
    }

    if (this.clientRegistry.size >= MAX_CLIENTS) {
      let oldestHash = null;
      let oldestTime = Infinity;
      for (const [key, val] of this.clientRegistry.entries()) {
        if (val.lastAccessed < oldestTime) {
          oldestTime = val.lastAccessed;
          oldestHash = key;
        }
      }
      if (oldestHash) {
        this.clientRegistry.delete(oldestHash);
        this.ctx?.logger?.info?.(
          '[AnthropicProvider] Evicted oldest tenant client to prevent memory leak',
          { hash: oldestHash }
        );
      }
    }

    const client = new Anthropic({ apiKey });
    this.clientRegistry.set(hash, { client, lastAccessed: now });
    return client;
  }

  async generateJSON(task, prompt, options, schema) {
    const client = await this._getClient(options.credentials);

    // The schema is described in the prompt rather than enforced through
    // output_config.format: that requires additionalProperties:false on every
    // object and rejects the minimum/maximum keywords our generation-schemas
    // use, so the schemas would have to be rewritten first. Ajv still validates
    // the result downstream in GenerationFacade.validateAndNormalize.
    let system = `You are an expert AI generator for ${task} data. Return only valid JSON, with no markdown fences and no commentary.`;
    if (schema) {
      system += `\n\nThe JSON output must conform to the following schema:\n\n${JSON.stringify(
        schema
      )}`;
    }

    // The model list is shared across providers, so a session configured for
    // OpenAI and switched to Anthropic can arrive here carrying a GPT model,
    // which would 404. Fall back rather than fail on a mismatched selection.
    const requested = options.model;
    const model =
      typeof requested === 'string' && requested.startsWith('claude')
        ? requested
        : DEFAULT_MODEL;

    if (requested && model !== requested) {
      this.ctx?.logger?.warn?.(
        `[AnthropicProvider] Ignoring non-Claude model "${requested}"; using ${DEFAULT_MODEL}`,
        { requested, model }
      );
    }

    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
      system,
      // Sampling parameters are rejected on this model family, so temperature
      // from the shared options is deliberately not forwarded.
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        'AI provider response truncated: output token limit reached (stop_reason: max_tokens). Please reduce chunk size or entity count.'
      );
    }

    if (response.stop_reason === 'refusal') {
      const category = response.stop_details?.category || 'unspecified';
      throw new Error(
        `Anthropic declined to generate this content (category: ${category}). Adjust the prompt or the requested content.`
      );
    }

    // Responses may carry thinking blocks alongside the answer; only the text
    // blocks hold the JSON.
    const text = (response.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    const parsed = tryParseJSON(text);
    if (typeof parsed === 'string' || parsed === null) {
      throw new Error(
        'AI provider returned invalid or unparseable JSON content.'
      );
    }
    return parsed;
  }

  async generateImage(_product, _options) {
    throw new Error(IMAGE_UNSUPPORTED_MESSAGE);
  }

  async validateCredentials(credentials) {
    try {
      const client = await this._getClient(credentials);
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = AnthropicProvider;
module.exports.IMAGE_UNSUPPORTED_MESSAGE = IMAGE_UNSUPPORTED_MESSAGE;
