const BaseAIProvider = require('./baseProvider.cjs');

class NanoBananaProvider extends BaseAIProvider {
  constructor(ctx) {
    super(ctx);
  }

  async generateJSON(_task, _prompt, _options, _schema) {
    throw new Error('Nano Banana provider only supports image generation');
  }

  /**
   * Not implemented, and it now says so.
   *
   * This used to return the literal string
   * `BASE64_PLACEHOLDER_FOR_NANOBANANA` and throw only when the key was
   * missing - so with a key present it *succeeded* and produced nothing
   * usable, which is worse than failing. The provider is no longer offered as
   * image-capable (#642), so this should be unreachable; throwing means a way
   * back in shows up as an error rather than as a catalogue of placeholder
   * strings.
   *
   * The real model exists as `nano-banana-pro-preview` in Gemini's catalogue.
   * Implementing it is a separate piece of work, and note it is a preview.
   */
  async generateImage(product) {
    throw new Error(
      'Nano Banana image generation is not implemented. Select OpenAI as the Media Provider, or set image generation to none.'
    );
  }

  async validateCredentials(credentials) {
    return !!credentials.apiKey;
  }
}

module.exports = NanoBananaProvider;
