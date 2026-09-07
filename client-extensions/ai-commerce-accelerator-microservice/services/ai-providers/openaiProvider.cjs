const crypto = require('crypto');
const OpenAI = require('openai');
const BaseAIProvider = require('./baseProvider.cjs');
const { tryParseJSON } = require('../../utils/misc.cjs');

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

  async generateJSON(task, prompt, options, schema) {
    const client = await this._getClient(options.credentials);

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

    if (schema) {
      messages[0].content += `\n\nThe JSON output must conform to the following schema:\n\n${JSON.stringify(
        schema
      )}`;
    }

    const response = await client.chat.completions.create({
      model: options.model || 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' },
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 16384,
    });

    const choice = response.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error(
        'AI provider response truncated: output token limit reached (finish_reason: length). Please reduce chunk size or product count.'
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
