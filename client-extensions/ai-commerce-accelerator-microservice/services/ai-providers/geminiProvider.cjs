const { GoogleGenerativeAI } = require('@google/generative-ai');
const BaseAIProvider = require('./baseProvider.cjs');
const { tryParseJSON } = require('../../utils/misc.cjs');

class GeminiProvider extends BaseAIProvider {
  constructor(ctx) {
    super(ctx);
    this.genAI = null;
  }

  async _getClient(credentials) {
    const apiKey = credentials.apiKey;
    if (!apiKey) throw new Error('Gemini API key missing');

    if (!this.genAI || this.genAI.apiKey !== apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    return this.genAI;
  }

  async generateJSON(task, prompt, options, schema) {
    const genAI = await this._getClient(options.credentials);
    const model = genAI.getGenerativeModel({
      model: options.model || 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const systemInstruction = `You are an expert AI generator for ${task} data. Return only valid JSON.${
      schema
        ? `\n\nThe JSON output must conform to the following schema:\n\n${JSON.stringify(schema)}`
        : ''
    }`;

    const result = await model.generateContent(
      `${systemInstruction}\n\n${prompt}`
    );
    const response = await result.response;
    const content = response.text();

    return tryParseJSON(content);
  }

  async generateImage(product, options) {
    // Note: Standard Gemini API doesn't do Image Gen (that's Vertex/Imagen)
    // For now, we'll suggest a fallback or mark as not supported.
    throw new Error('Image generation not supported yet for Gemini provider');
  }

  async validateCredentials(credentials) {
    try {
      const genAI = await this._getClient(credentials);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      await model.generateContent('ping');
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = GeminiProvider;
