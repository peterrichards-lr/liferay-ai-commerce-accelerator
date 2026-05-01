const BaseAIProvider = require('./baseProvider.cjs');

class NanoBananaProvider extends BaseAIProvider {
  constructor(ctx) {
    super(ctx);
  }

  async generateJSON(task, prompt, options, schema) {
    throw new Error('Nano Banana provider only supports image generation');
  }

  async generateImage(product, options) {
    const apiKey = options.credentials?.apiKey;
    if (!apiKey) throw new Error('Nano Banana API key missing');

    // This is a placeholder for the actual Nano Banana integration.
    // In a real implementation, we would call the Nano Banana API here.
    this.ctx.logger.info('Generating image via Nano Banana...', {
      productName: product.name?.en_US || product.name,
    });

    // Mock response for now (would be a real fetch call)
    return 'BASE64_PLACEHOLDER_FOR_NANOBANANA';
  }

  async validateCredentials(credentials) {
    return !!credentials.apiKey;
  }
}

module.exports = NanoBananaProvider;
