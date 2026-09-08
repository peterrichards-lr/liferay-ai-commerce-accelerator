const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const BaseAIProvider = require('./baseProvider.cjs');
const { tryParseJSON } = require('../../utils/misc.cjs');
const {
  expandOpenMapsForPrompt,
  looksLikeSchemaRejection,
  projectGenerationSchema,
} = require('../../utils/schemaProjection.cjs');

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 16384;
const MAX_CLIENTS = 10;

const IMAGE_UNSUPPORTED_MESSAGE =
  'Claude does not support image generation. Please configure a dedicated Media Provider (OpenAI).';

class AnthropicProvider extends BaseAIProvider {
  constructor(ctx) {
    super(ctx);
    this.clientRegistry = new Map();
    this.structuredOutputRegistry = new Map();
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

  /**
   * Whether this model will accept output_config.format, taken from the models
   * endpoint rather than assumed.
   *
   * Cached per model for the life of the process: the answer is a property of
   * the model, and one extra GET is not worth repeating per generation call.
   * A lookup that fails is treated as capable, because the alternative is
   * withholding a working feature over a transient error - a model that turns
   * out not to support it is caught by the rejection fallback below.
   */
  async _supportsStructuredOutput(client, model) {
    if (this.structuredOutputRegistry.has(model)) {
      return this.structuredOutputRegistry.get(model);
    }

    let supported = true;

    try {
      const described = await client.models.retrieve(model);
      const reported = described?.capabilities?.structured_outputs?.supported;
      if (reported === false) supported = false;
    } catch (error) {
      this.ctx?.logger?.debug?.(
        `[AnthropicProvider] Could not read structured-output capability for ${model}`,
        { message: error.message, model }
      );
    }

    this.structuredOutputRegistry.set(model, supported);
    return supported;
  }

  async generateJSON(task, prompt, options, schema) {
    const client = await this._getClient(options.credentials);

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

    // The generation-schemas are not rewritten to suit the structured-output
    // subset - they are the ajv gate and legitimately need minimum/maximum and
    // open locale maps - so a provider-acceptable schema is projected from them
    // here instead. Ajv still validates the values downstream in
    // GenerationFacade.validateAndNormalize. See #633.
    const projection = schema
      ? projectGenerationSchema(schema, {
          languages: options.languages,
          provider: 'anthropic',
        })
      : { blockers: [], schema: null };

    if (schema && !projection.schema) {
      this.ctx?.logger?.debug?.(
        `[AnthropicProvider] ${task} schema cannot be expressed as a structured output; describing it in the prompt`,
        { blockers: projection.blockers, model }
      );
    }

    const outputSchema =
      projection.schema && (await this._supportsStructuredOutput(client, model))
        ? projection.schema
        : null;

    try {
      return await this._message(client, task, prompt, options, {
        model,
        outputSchema,
        schema,
      });
    } catch (error) {
      if (!outputSchema || !looksLikeSchemaRejection(error)) {
        throw error;
      }

      this.ctx?.logger?.warn?.(
        `[AnthropicProvider] ${model} rejected the ${task} output schema; retrying with the schema in the prompt`,
        { message: error.message, model }
      );

      return await this._message(client, task, prompt, options, {
        model,
        outputSchema: null,
        schema,
      });
    }
  }

  async _message(
    client,
    task,
    prompt,
    options,
    { model, outputSchema, schema }
  ) {
    let system = `You are an expert AI generator for ${task} data. Return only valid JSON, with no markdown fences and no commentary.`;

    // Described in the prompt only when it is not being sent as a schema:
    // stating it twice doubles the schema's tokens for no added constraint.
    if (schema && !outputSchema) {
      system += `\n\nThe JSON output must conform to the following schema:\n\n${JSON.stringify(
        expandOpenMapsForPrompt(schema, options.languages)
      )}`;
    }

    const request = {
      model,
      max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
      system,
      // Sampling parameters are rejected on this model family, so temperature
      // from the shared options is deliberately not forwarded.
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    };

    if (outputSchema) {
      // output_config.format, not the deprecated output_format parameter.
      request.output_config = {
        format: { schema: outputSchema, type: 'json_schema' },
      };
    }

    const response = await client.messages.create(request);

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
