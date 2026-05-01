class BaseAIProvider {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * Generates a JSON response from a prompt.
   * @param {string} _task - Description of the task (e.g., 'product', 'account')
   * @param {string} _prompt - The full prompt string
   * @param {object} _options - Generation options (model, temperature, etc)
   * @param {object} _schema - (Optional) JSON schema for validation/steering
   * @returns {Promise<object>} - Parsed JSON response
   */
  async generateJSON(_task, _prompt, _options, _schema) {
    throw new Error('generateJSON not implemented');
  }

  /**
   * Generates a base64 image string for a product.
   * @param {object} _product - The product data
   * @param {object} _options - Image options (style, width, height)
   * @returns {Promise<string>} - Base64 encoded image string
   */
  async generateImage(_product, _options) {
    throw new Error('generateImage not implemented');
  }

  /**
   * Validates the API key or credentials for the provider.
   * @param {object} _credentials - Provider credentials
   * @returns {Promise<boolean>}
   */
  async validateCredentials(_credentials) {
    throw new Error('validateCredentials not implemented');
  }
}

module.exports = BaseAIProvider;
