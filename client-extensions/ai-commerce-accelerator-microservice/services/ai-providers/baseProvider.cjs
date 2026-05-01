class BaseAIProvider {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * Generates a JSON response from a prompt.
   * @param {string} task - Description of the task (e.g., 'product', 'account')
   * @param {string} prompt - The full prompt string
   * @param {object} options - Generation options (model, temperature, etc)
   * @param {object} schema - (Optional) JSON schema for validation/steering
   * @returns {Promise<object>} - Parsed JSON response
   */
  async generateJSON(task, prompt, options, schema) {
    throw new Error('generateJSON not implemented');
  }

  /**
   * Generates a base64 image string for a product.
   * @param {object} product - The product data
   * @param {object} options - Image options (style, width, height)
   * @returns {Promise<string>} - Base64 encoded image string
   */
  async generateImage(product, options) {
    throw new Error('generateImage not implemented');
  }

  /**
   * Validates the API key or credentials for the provider.
   * @param {object} credentials - Provider credentials
   * @returns {Promise<boolean>}
   */
  async validateCredentials(credentials) {
    throw new Error('validateCredentials not implemented');
  }
}

module.exports = BaseAIProvider;
