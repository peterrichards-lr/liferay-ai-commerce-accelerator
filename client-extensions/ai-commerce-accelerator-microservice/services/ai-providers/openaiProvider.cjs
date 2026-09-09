const crypto = require('crypto');
const OpenAI = require('openai');
const BaseAIProvider = require('./baseProvider.cjs');
const { tryParseJSON } = require('../../utils/misc.cjs');
const {
  requestOptions,
  resolveMaxTokens,
} = require('../../utils/aiRequestOptions.cjs');
const {
  expandOpenMapsForPrompt,
  looksLikeSchemaRejection,
  projectGenerationSchema,
} = require('../../utils/schemaProjection.cjs');

const DEFAULT_MODEL = 'gpt-4o-mini';

const JSON_OBJECT_FORMAT = { type: 'json_object' };

/**
 * Models that predate `response_format: { type: 'json_schema' }`. Everything
 * from gpt-4o-mini and gpt-4o-2024-08-06 onwards supports it, so this is a
 * denylist rather than an allowlist: the model list is runtime data an
 * administrator can add to, and a newer model this build has never heard of
 * should get structured output rather than be quietly downgraded. Anything that
 * slips through is caught by the rejection fallback in generateJSON.
 */
const NO_JSON_SCHEMA_MODELS = [/^gpt-3\.5/i, /^gpt-4(?:$|[-.]turbo|-0|-1)/i];

function supportsJsonSchema(model) {
  const id = String(model || '');
  return !NO_JSON_SCHEMA_MODELS.some((pattern) => pattern.test(id));
}

/**
 * The image model. Verified against /v1/models rather than chosen from memory:
 * `dall-e-3` and `dall-e-2` are gone from the catalogue entirely, and of what
 * remains only gpt-image-2 carries no shutdown_date - gpt-image-1 retires
 * 2026-10-23, gpt-image-1.5 and chatgpt-image-latest on 2026-12-01. Offering a
 * model that is about to be withdrawn buys a working demo now and a broken one
 * later, with nothing in between to warn anybody.
 */
const IMAGE_MODEL = 'gpt-image-2';

// The gpt-image family accepts low, medium, high and auto. `standard` and `hd`
// are dall-e values, and `standard` is what normalize.cjs still defaults to, so
// an unmapped value would have failed every run rather than an unusual one.
const IMAGE_QUALITY = new Map([
  ['auto', 'auto'],
  ['hd', 'high'],
  ['high', 'high'],
  ['low', 'low'],
  ['medium', 'medium'],
  ['standard', 'medium'],
]);

function imageQuality(requested) {
  const key = String(requested || '').toLowerCase();
  // 'auto' rather than a fixed tier for anything unrecognised: it lets the
  // provider choose instead of this silently downgrading somebody's request.
  return IMAGE_QUALITY.get(key) || 'auto';
}

// gpt-image-2 rejects anything below its minimum pixel budget with
// "400 Invalid size '512x512'. Requested resolution is below the current
// minimum pixel budget." The configuration UI defaults to 512 (see
// utils/normalize.cjs), so the floor has to be enforced here rather than
// trusting the caller.
const MIN_IMAGE_DIMENSION = 1024;

/**
 * Both dimensions must be divisible by 16 - the API rejects anything else -
 * and the caller's width and height are free-form numbers.
 */
function imageSize(width, height) {
  const round = (value, fallback) => {
    const n = Number(value) || fallback;
    return Math.max(MIN_IMAGE_DIMENSION, Math.round(n / 16) * 16);
  };

  return `${round(width, MIN_IMAGE_DIMENSION)}x${round(height, MIN_IMAGE_DIMENSION)}`;
}

class OpenAIProvider extends BaseAIProvider {
  constructor(ctx) {
    super(ctx);
    this.clientRegistry = new Map();
  }

  async _getClient(credentials) {
    const apiKey = credentials.apiKey;
    if (!apiKey) throw new Error('OpenAI API key missing');

    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const now = Date.now();

    if (this.clientRegistry.has(hash)) {
      const entry = this.clientRegistry.get(hash);
      entry.lastAccessed = now;
      return entry.client;
    }

    const MAX_CLIENTS = 10;
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
        const evicted = this.clientRegistry.get(oldestHash);
        this.clientRegistry.delete(oldestHash);
        if (
          evicted.client &&
          evicted.client.httpAgent &&
          typeof evicted.client.httpAgent.destroy === 'function'
        ) {
          evicted.client.httpAgent.destroy();
        }
        this.ctx?.logger?.info?.(
          `[OpenAIProvider] Evicted oldest tenant client to prevent memory leak`,
          { hash: oldestHash }
        );
      }
    }

    const client = new OpenAI({ apiKey });
    this.clientRegistry.set(hash, { client, lastAccessed: now });
    return client;
  }

  /**
   * The response_format for this call: an enforced json_schema when the
   * generation schema projects cleanly into strict mode, an unenforced one when
   * it does not, and plain JSON mode when the model cannot take a schema at
   * all.
   */
  _responseFormat(task, schema, options, model) {
    if (!schema || !supportsJsonSchema(model)) {
      return JSON_OBJECT_FORMAT;
    }

    const projectionOptions = {
      languages: options.languages,
      provider: 'openai',
    };
    const enforced = projectGenerationSchema(schema, projectionOptions);

    if (enforced.schema) {
      return {
        json_schema: {
          name: `${task}_response`,
          schema: enforced.schema,
          strict: true,
        },
        type: 'json_schema',
      };
    }

    // Strict mode requires every object to be closed, so a map whose keys are
    // not known at the call site cannot be expressed. No shipped generation
    // schema has one any more - #691 gave the last of them, skuVariants[]
    // .options, a pair-array wire form - but a schema an administrator adds
    // still can, and sending it unenforced gives the model the expanded locale
    // maps as a schema rather than as prose. ajv and the retry remain the gate.
    const advisory = projectGenerationSchema(schema, {
      ...projectionOptions,
      mode: 'advisory',
    });

    if (!advisory.schema) {
      return JSON_OBJECT_FORMAT;
    }

    this.ctx?.logger?.debug?.(
      `[OpenAIProvider] ${task} schema cannot be enforced in strict mode; sending it unenforced`,
      { blockers: enforced.blockers, model }
    );

    return {
      json_schema: {
        name: `${task}_response`,
        schema: advisory.schema,
        strict: false,
      },
      type: 'json_schema',
    };
  }

  async generateJSON(task, prompt, options, schema) {
    const client = await this._getClient(options.credentials);
    const model = options.model || DEFAULT_MODEL;
    const responseFormat = this._responseFormat(task, schema, options, model);

    try {
      return await this._chat(client, task, prompt, options, {
        model,
        responseFormat,
        schema,
      });
    } catch (error) {
      if (
        responseFormat.type === 'json_object' ||
        !looksLikeSchemaRejection(error)
      ) {
        throw error;
      }

      // A model that cannot take this schema must not end the run: fall back to
      // what every call did before structured output existed.
      this.ctx?.logger?.warn?.(
        `[OpenAIProvider] ${model} rejected the ${task} response schema; retrying with JSON mode`,
        { message: error.message, model }
      );

      return await this._chat(client, task, prompt, options, {
        model,
        responseFormat: JSON_OBJECT_FORMAT,
        schema,
      });
    }
  }

  async _chat(
    client,
    task,
    prompt,
    options,
    { model, responseFormat, schema }
  ) {
    const messages = [
      {
        role: 'system',
        content: `You are an expert AI generator for ${task} data. Return only valid JSON.`,
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    // Only described in the prompt when it is not being sent as a schema:
    // pasting it in both places doubles the schema's tokens and gives the model
    // two statements of the same thing to reconcile.
    if (schema && responseFormat.type === 'json_object') {
      messages[0].content += `\n\nThe JSON output must conform to the following schema:\n\n${JSON.stringify(
        expandOpenMapsForPrompt(schema, options.languages)
      )}`;
    }

    // Resolved once so the number logged is provably the number sent, and
    // resolved by the shared helper so the default lives in one place rather
    // than being repeated as a literal here (#823).
    const maxTokens = resolveMaxTokens(options.maxTokens);

    const response = await client.chat.completions.create(
      {
        model,
        messages,
        response_format: responseFormat,
        temperature: options.temperature || 0.7,
        max_tokens: maxTokens,
      },
      requestOptions(options)
    );

    this.ctx?.logger?.info?.('[OpenAIProvider] Token usage', {
      model,
      task,
      maxTokens,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      finishReason: response.choices?.[0]?.finish_reason,
    });

    const choice = response.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error(
        'AI provider response truncated: output token limit reached (finish_reason: length). Please reduce chunk size or product count.'
      );
    }

    if (choice?.message?.refusal) {
      throw new Error(
        `OpenAI declined to generate this content: ${choice.message.refusal}`
      );
    }

    const content = choice?.message?.content;
    const parsed = tryParseJSON(content);
    if (typeof parsed === 'string') {
      throw new Error(
        'AI provider returned invalid or unparseable JSON content.'
      );
    }
    return parsed;
  }

  async generateImage(product, options) {
    const client = await this._getClient(options.credentials);

    // Rendered by aiService from prompts/image.md, so an operator can edit it
    // and so brand context reaches images the way it reaches every other
    // generator. The fallback covers a caller that has not been updated -
    // notably the MCP path and any direct provider use in tests - rather than
    // failing a run over a missing prompt.
    const prompt =
      options.prompt ||
      `A high-quality, professional product photograph of a ${
        product.name?.en_US || product.name
      }. Style: ${options.imageStyle || 'photographic'} on a clean background.`;

    const response = await client.images.generate({
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size: imageSize(options.imageWidth, options.imageHeight),
      quality: imageQuality(options.imageQuality),
      // No response_format. The gpt-image family rejects it outright -
      // "Unknown parameter: 'response_format'" - and returns base64 by
      // default, which is what this method wants. It was a dall-e parameter.
    });

    return response.data[0].b64_json;
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

module.exports = OpenAIProvider;
