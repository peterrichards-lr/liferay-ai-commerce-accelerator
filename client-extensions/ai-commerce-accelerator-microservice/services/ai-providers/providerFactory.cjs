const OpenAIProvider = require('./openaiProvider.cjs');
const GeminiProvider = require('./geminiProvider.cjs');
const NanoBananaProvider = require('./nanobananaProvider.cjs');
const AnthropicProvider = require('./anthropicProvider.cjs');

class AIProviderFactory {
  constructor(ctx) {
    this.ctx = ctx;
    this.providers = new Map();
  }

  getProvider(name) {
    const providerName = (name || 'openai').toLowerCase();

    if (this.providers.has(providerName)) {
      return this.providers.get(providerName);
    }

    let provider;
    switch (providerName) {
      case 'openai':
        provider = new OpenAIProvider(this.ctx);
        break;
      case 'gemini':
        provider = new GeminiProvider(this.ctx);
        break;
      case 'nanobanana':
        provider = new NanoBananaProvider(this.ctx);
        break;
      case 'anthropic':
        provider = new AnthropicProvider(this.ctx);
        break;
      default:
        throw new Error(`Unsupported AI provider: ${name}`);
    }

    this.providers.set(providerName, provider);
    return provider;
  }
}

module.exports = AIProviderFactory;
