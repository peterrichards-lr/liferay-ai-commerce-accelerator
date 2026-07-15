const OpenAI = require('openai');
const crypto = require('crypto');
const BaseAIProvider = require('./baseProvider.cjs');
const { tryParseJSON } = require('../../utils/misc.cjs');

class OpenAIProvider extends BaseAIProvider {
  constructor(ctx) {
    super(ctx);
    this.clients = new Map();
  }

  async _getClient(credentials) {
    const apiKey = credentials.apiKey;
    if (!apiKey) throw new Error('OpenAI API key missing');

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    if (!this.clients.has(keyHash)) {
      this.clients.set(keyHash, new OpenAI({ apiKey }));
    }
    return this.clients.get(keyHash);
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
      max_tokens: options.maxTokens || 4000,
    });

    const content = response.choices[0].message.content;
    return tryParseJSON(content);
  }

  async generateImage(product, options) {
    const client = await this._getClient(options.credentials);

    const prompt = `A high-quality, professional product photograph of a ${
      product.name?.en_US || product.name
    }. Style: ${options.imageStyle || 'photographic'} on a clean background.`;

    const response = await client.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: `${options.imageWidth || 1024}x${options.imageHeight || 1024}`,
      quality: options.imageQuality || 'standard',
      response_format: 'b64_json',
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
