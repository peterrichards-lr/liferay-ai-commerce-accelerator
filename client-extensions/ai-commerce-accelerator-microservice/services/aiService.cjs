const OpenAI = require('openai');
const {
  pluralize,
  pricingHints,
  joinList,
} = require('../utils/promptHelpers.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class AIService {
  constructor(ctx) {
    this.ctx = ctx;
    this.openai = null;
  }

  async getRuntimeAIConfig(requestConfig) {
    const { configService } = this.ctx;
    const aiCfg = (await configService.getAIConfig(requestConfig)) || {};

    return {
      model: aiCfg.defaultModel || 'gpt-4o',
      temperature:
        typeof aiCfg.temperature === 'number' ? aiCfg.temperature : 0.7,
      maxTokens:
        (aiCfg.maxTokens && aiCfg.maxTokens.default) || aiCfg.maxTokens || 4000,
      responseFormat:
        aiCfg.responseFormat === 'json_object' ? 'json_object' : 'json_object',
      requestTimeoutMs:
        typeof aiCfg.requestTimeoutMs === 'number'
          ? aiCfg.requestTimeoutMs
          : 60000,
    };
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
      if (!apiKey) {
        throw new Error('OpenAI API key not configured');
      }

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
      const parsed = tryParseJSON(content, null);

      if (parsed === null) {
        const err = new Error(
          `AIService._chatJson received non-JSON response for task "${task}"`
        );
        throw err;
      }

      return parsed;
    } catch (error) {
      logger?.error?.(`AIService._chatJson failed for ${task}:`, {
        message: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
  async generatePDFContent(product, category, requestConfig, model) {
    const { logger, promptService } = this.ctx;
    const correlationId = requestConfig?.correlationId;
    try {
      const vars = {
        productName: product.name?.en_US || product.name,
        productDescription: product.description?.en_US || product.description,
        category,
        specificationsJSON: JSON.stringify(
          product.specifications || {},
          null,
          2
        ),
      };

      const prompt = await promptService.render('pdf', vars);
      return await this._chatJson('pdf', prompt, requestConfig, model);
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('AIService.generatePDFContent failed', {
        correlationId,
        errorReference,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

      const wrapped = new Error(
        `AI service error: ${error.message || 'Failed to generate PDF content'}`
      );
      wrapped.errorReference = errorReference;
      throw wrapped;
    }
  }

  async generateProductData(
    category,
    count = 1,
    requestConfig,
    model,
    selectedLanguages = ['en-US']
  ) {
    const { logger, promptService } = this.ctx;
    const correlationId = requestConfig?.correlationId;
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
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('AIService.generateProductData failed', {
        correlationId,
        errorReference,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

      const wrapped = new Error(
        `AI service error: ${
          error.message || 'Failed to generate product data'
        }`
      );
      wrapped.errorReference = errorReference;
      throw wrapped;
    }
  }

  async generateAccountData(count = 1, requestConfig, model) {
    const { logger, promptService } = this.ctx;
    const correlationId = requestConfig?.correlationId;
    try {
      const vars = {
        count,
        pluralSuffix: pluralize(count),
      };

      const prompt = await promptService.render('account', vars);
      const obj = await this._chatJson('account', prompt, requestConfig, model);

      return obj.accounts || [obj];
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('AIService.generateAccountData failed', {
        correlationId,
        errorReference,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

      const wrapped = new Error(
        `AI service error: ${
          error.message || 'Failed to generate account data'
        }`
      );
      wrapped.errorReference = errorReference;
      throw wrapped;
    }
  }

  async generateOrderData(products, accounts, count = 1, requestConfig, model) {
    const { logger, promptService } = this.ctx;
    const correlationId = requestConfig?.correlationId;
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
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('AIService.generateOrderData failed', {
        correlationId,
        errorReference,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

      const wrapped = new Error(
        `AI service error: ${error.message || 'Failed to generate order data'}`
      );
      wrapped.errorReference = errorReference;
      throw wrapped;
    }
  }

  async generatePricingData(
    products,
    pricingType = 'standard',
    requestConfig,
    model
  ) {
    const { logger, promptService } = this.ctx;
    const correlationId = requestConfig?.correlationId;
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
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('AIService.generatePricingData failed', {
        correlationId,
        errorReference,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

      const wrapped = new Error(
        `AI service error: ${
          error.message || 'Failed to generate pricing data'
        }`
      );
      wrapped.errorReference = errorReference;
      throw wrapped;
    }
  }
}

module.exports = { AIService };
