const OpenAIProvider = require('./openaiProvider.cjs');
const GeminiProvider = require('./geminiProvider.cjs');
const NanoBananaProvider = require('./nanobananaProvider.cjs');
const AnthropicProvider = require('./anthropicProvider.cjs');

/**
 * The adapter each declared provider is served by.
 *
 * The keys are the only place outside utils/providerRegistry.cjs that a
 * provider id is written down, and they have to be: CommonJS requires a literal
 * path, so the association between an id and its class cannot be derived. It is
 * checked instead - tests/providerRegistry.test.cjs asserts these keys are
 * exactly the registry's ids, so a provider declared without an adapter, or an
 * adapter for a provider nobody declared, fails the build rather than throwing
 * "Unsupported AI provider" at an operator midway through a run.
 */
const ADAPTERS = new Map([
  ['anthropic', AnthropicProvider],
  ['gemini', GeminiProvider],
  ['nanobanana', NanoBananaProvider],
  ['openai', OpenAIProvider],
]);

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

    const Adapter = ADAPTERS.get(providerName);

    if (!Adapter) {
      throw new Error(`Unsupported AI provider: ${name}`);
    }

    const provider = new Adapter(this.ctx);

    this.providers.set(providerName, provider);
    return provider;
  }
}

module.exports = AIProviderFactory;
module.exports.ADAPTERS = ADAPTERS;
