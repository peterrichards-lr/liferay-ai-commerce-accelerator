const OpenAI = require('openai');
const {
  pluralize,
  pricingHints,
  joinList,
} = require('../utils/promptHelpers.cjs');

class AIService {
  constructor(ctx) {
    this.ctx = ctx;
    this.openai = null;

    this.defaultModel = 'gpt-4o';
    this.defaultTemperature = 0.7;
    this.maxTokens = 4000;
  }

  async getOpenAIClient(requestConfig) {
    const { configService } = this.ctx;
    if (!this.openai) {
      if (!requestConfig) {
        throw new Error(
          'OAuth configuration required to initialize OpenAI client'
        );
      }
      const apiKey = await configService.getOpenAIKey(requestConfig);
      this.openai = new OpenAI({ apiKey });
    }
    return this.openai;
  }

  async _chatJson(task, prompt, requestConfig, model) {
    const { logger } = this.ctx;
    try {
      const openai = await this.getOpenAIClient(requestConfig);
      const response = await openai.chat.completions.create({
        model: model || this.defaultModel,
        messages: [
          {
            role: 'system',
            content: `You are an expert AI generator for ${task} data. Return only valid JSON.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: this.defaultTemperature,
        max_tokens: this.maxTokens,
      });

      const content = response.choices[0].message.content;
      return JSON.parse(content);
    } catch (error) {
      logger?.error?.(`AIService._chatJson failed for ${task}:`, error);
      throw error;
    }
  }

  async generatePDFContent(
    product,
    category,
    requestConfig,
    model = this.defaultModel
  ) {
    const { logger, promptService } = this.ctx;
    try {
      const vars = {
        productName: product.name?.en_US || product.name,
        productDescription: product.description?.en_US || product.description,
        category,
        specificationsJSON: JSON.stringify(product.specifications || {}),
      };
      const prompt = await promptService.render('pdf', vars);
      const obj = await this._chatJson('pdf', prompt, requestConfig, model);
      return obj;
    } catch (error) {
      logger?.error?.('Error generating PDF content:', error);
      throw error;
    }
  }

  async generateProductData(
    category,
    count = 1,
    requestConfig,
    model = this.defaultModel,
    selectedLanguages = ['en-US']
  ) {
    const { logger, promptService } = this.ctx;
    try {
      const langs =
        Array.isArray(selectedLanguages) && selectedLanguages.length
          ? selectedLanguages
          : ['en-US'];
      const languageCodes = langs.map((l) => l.replace('-', '_'));

      const vars = {
        category,
        count,
        pluralSuffix: pluralize(count),
        languageList: joinList(langs),
        languageCodesCSV: languageCodes.join(', '),
        languageCodesNamePairs: languageCodes
          .map((code) => `"${code}": "translated name"`)
          .join(', '),
        languageCodesNameBlock: languageCodes
          .map(
            (code) =>
              `"${code}": "Product Name in ${code.replace('_', '-')} language"`
          )
          .join(',\n    '),
        languageCodesUrlBlock: languageCodes
          .map(
            (code) =>
              `"${code}": "product-name-in-${code
                .replace('_', '-')
                .toLowerCase()}"`
          )
          .join(',\n    '),
      };

      const prompt = await promptService.render('product', vars);
      const obj = await this._chatJson('product', prompt, requestConfig, model);
      return obj.products || [obj];
    } catch (error) {
      logger?.error?.('AI product generation failed:', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  async generateAccountData(
    count = 1,
    requestConfig,
    model = this.defaultModel
  ) {
    const { logger, promptService } = this.ctx;
    try {
      const vars = { count, pluralSuffix: pluralize(count) };
      const prompt = await promptService.render('account', vars);
      const obj = await this._chatJson('account', prompt, requestConfig, model);
      return obj.accounts || [obj];
    } catch (error) {
      logger?.error?.('AI account generation failed:', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  async generateOrderData(
    products,
    accounts,
    count = 1,
    requestConfig,
    model = this.defaultModel
  ) {
    const { logger, promptService } = this.ctx;
    try {
      const productList = products
        .map((p) => ({
          name: p.name?.en_US || p.name,
          sku: p.sku,
          id: p.id,
        }))
        .slice(0, 10);

      const accountList = accounts
        .map((a) => ({
          name: a.name,
          id: a.id,
        }))
        .slice(0, 10);

      const vars = {
        count,
        pluralSuffix: pluralize(count),
        productListJSON: JSON.stringify(productList, null, 2),
        accountListJSON: JSON.stringify(accountList, null, 2),
      };

      const prompt = await promptService.render('order', vars);
      const obj = await this._chatJson('order', prompt, requestConfig, model);
      return obj.orders || [obj];
    } catch (error) {
      logger?.error?.('AI order generation failed:', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  async generatePricingData(
    products,
    pricingType = 'standard',
    requestConfig,
    model = this.defaultModel
  ) {
    const { logger, promptService } = this.ctx;
    try {
      const productList = products.map((p) => ({
        name: p.name?.en_US || p.name,
        sku: p.sku,
        id: p.id,
      }));

      const vars = {
        pricingType,
        productListJSON: JSON.stringify(productList, null, 2),
        ...pricingHints(pricingType),
      };

      const prompt = await promptService.render('pricing', vars);
      const obj = await this._chatJson('pricing', prompt, requestConfig, model);
      return obj;
    } catch (error) {
      logger?.error?.('AI pricing generation failed:', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }
}

module.exports = { AIService };
