const OpenAI = require('openai');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');
const {
  pluralize,
  pricingHints,
  joinList,
} = require('../utils/promptHelpers.cjs');
const { createERC, tryParseJSON } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class AIService {
  constructor(ctx) {
    this.ctx = ctx;
    this.openai = null;

    this.defaultModel = null;
    this.defaultTemperature = 0.7;
    this.maxTokens = 4000;
    this.requestTimeoutMs = 60000;

    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
    this.localSchemas = {};
  }

  _validateResponse(data, schemaName) {
    if (!schemaName) return data;

    let validator = this.localSchemas[schemaName];
    if (!validator) {
      const schemaPath = path.join(
        __dirname,
        `../generation-schemas/${schemaName}.json`
      );
      if (fs.existsSync(schemaPath)) {
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        validator = this.ajv.compile(schema);
        this.localSchemas[schemaName] = validator;
      }
    }

    if (validator) {
      const isValid = validator(data);
      if (!isValid) {
        this.ctx.logger.error(
          `AI generated data for ${schemaName} violates internal schema`,
          {
            errors: validator.errors,
          }
        );
        // We don't throw here to allow for partial data, but we log the issue.
      }
    }
    return data;
  }

  _getActualDataFromAIResponse(parsedResponse, schemaName) {
    if (
      !parsedResponse ||
      typeof parsedResponse !== 'object' ||
      parsedResponse === null
    ) {
      return parsedResponse;
    }

    const mainPropertyName = schemaName + 's';

    if (
      parsedResponse.$schema &&
      parsedResponse.properties &&
      parsedResponse.properties[mainPropertyName]
    ) {
      return {
        [mainPropertyName]: parsedResponse.properties[mainPropertyName],
      };
    }

    if (
      parsedResponse[mainPropertyName] &&
      Array.isArray(parsedResponse[mainPropertyName])
    ) {
      return { [mainPropertyName]: parsedResponse[mainPropertyName] };
    }

    if (Array.isArray(parsedResponse)) {
      return parsedResponse;
    }

    return parsedResponse;
  }

  async getRuntimeAIConfig(requestConfig) {
    const { config } = this.ctx;
    const aiCfg = (await config.getAIConfig(requestConfig)) || {};

    // HARDENING: If key was passed in request, ensure it's available in the returned config
    if (requestConfig.openAiKey) {
      aiCfg.openAiKey = requestConfig.openAiKey;
    }

    if (!aiCfg.defaultModel) {
      const err = new Error(
        'AI model not configured. Please select an AI model in the AI Configuration object.'
      );
      err.statusCode = 400;
      throw err;
    }

    const model = aiCfg.defaultModel;
    const temperature =
      typeof aiCfg.temperature === 'number' ? aiCfg.temperature : 0.7;
    const maxTokens =
      (aiCfg.maxTokens && aiCfg.maxTokens.default) || aiCfg.maxTokens || 4000;
    const responseFormat =
      aiCfg.responseFormat === 'json_object' ? 'json_object' : 'json_object';
    const requestTimeoutMs =
      typeof aiCfg.requestTimeoutMs === 'number'
        ? aiCfg.requestTimeoutMs
        : 60000;

    this.defaultModel = model;
    this.defaultTemperature = temperature;
    this.maxTokens = maxTokens;
    this.requestTimeoutMs = requestTimeoutMs;

    return {
      model,
      temperature,
      maxTokens,
      responseFormat,
      requestTimeoutMs,
    };
  }

  async getOpenAIClient(requestConfig) {
    const { config } = this.ctx;

    // HARDENING: Prefer the key from the runtime config if available
    const apiKey =
      requestConfig?.openAiKey || (await config.getOpenAIKey(requestConfig));

    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!this.openai || this.openai.apiKey !== apiKey) {
      this.openai = new OpenAI({ apiKey });
    }

    return this.openai;
  }

  async _chatJson(task, prompt, requestConfig, model, schemaName) {
    const { logger, config } = this.ctx;
    try {
      const openai = await this.getOpenAIClient(requestConfig);
      const runtime = await this.getRuntimeAIConfig(requestConfig);

      const schema = schemaName
        ? await config.getAISchema(requestConfig, schemaName)
        : null;

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

      const response = await openai.chat.completions.create({
        model: model || runtime.model,
        messages,
        response_format: { type: 'json_object' },
        temperature: runtime.temperature,
        max_tokens: runtime.maxTokens,
      });

      const content = response.choices[0].message.content;

      if (logger && logger.trace) {
        const truncatedContent =
          content && content.length > 4000
            ? content.slice(0, 4000) + '…'
            : content;
        logger.trace('AIService._chatJson raw response', {
          task,
          truncatedContent,
          correlationId: requestConfig.correlationId,
        });
      }

      const parsed = tryParseJSON(content, null);

      if (logger && logger.trace && parsed !== null) {
        logger.trace('AIService._chatJson parsed response preview', {
          task,
          parsedPreview: Array.isArray(parsed) ? parsed.slice(0, 3) : parsed,
          correlationId: requestConfig.correlationId,
        });
      }

      if (parsed === null) {
        throw new Error(
          `AIService._chatJson received non-JSON response for task "${task}"`
        );
      }

      const processedCandidate = this._getActualDataFromAIResponse(
        parsed,
        schemaName
      );

      return this._validateResponse(processedCandidate, schemaName);
    } catch (error) {
      logger?.error?.(`AIService._chatJson failed for ${task}:`, {
        message: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  async generatePDFContent(product, category, requestConfig, model) {
    const { logger, prompt } = this.ctx;
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

      const promptContent = await prompt.render('pdf', vars, requestConfig);
      return await this._chatJson(
        'pdf',
        promptContent,
        requestConfig,
        model,
        'pdf'
      );
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
    selectedLanguages = ['en-US'],
    options = {}
  ) {
    const { logger, prompt } = this.ctx;
    const correlationId = requestConfig?.correlationId;
    try {
      const langs =
        Array.isArray(selectedLanguages) && selectedLanguages.length
          ? selectedLanguages
          : ['en-US'];

      const languageCodes = langs.map((l) => l.replace('-', '_'));

      const vars = {
        brandName: options.brandName || '',
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
        priceEntriesInstruction:
          options.generatePriceLists ||
          options.generateBulkPricing ||
          options.generateTierPricing
            ? `- priceEntries: array of price list entry objects. Each object must have:
            - price (number): The unit price.
            - skuExternalReferenceCode (string): This MUST be the same as the SKU's "sku" code (e.g., "PRODUCT-001-BLK-L").
            - priceListExternalReferenceCode (string): Always use "AICA-PL-GENERAL".
            - externalReferenceCode (string): Unique identifier for this entry.
            - discountDiscovery (boolean): Always set to false.
            - sku (object): A nested object containing:
              - basePrice (number): The same value as the top-level price.
              - basePromoPrice (number or null): The promotional price for this SKU. Generate this for approximately 20% of products.
            ${
              options.generateBulkPricing || options.generateTierPricing
                ? `
            - bulkPricing (boolean): ${options.generateBulkPricing ? 'Set to true for Bulk Pricing (same price for all items if threshold reached).' : 'Set to false for Tiered Pricing (different prices for quantity ranges).'}
            - tierPrices (array): List of objects with "minimumQuantity" (number), "price" (number), and "externalReferenceCode" (string). Generate at least two tiers (e.g., 5+ and 10+).`
                : ''
            }`
            : '',
      };

      const promptContent = await prompt.render('product', vars, requestConfig);
      return await this._chatJson(
        'product',
        promptContent,
        requestConfig,
        model,
        'product'
      );
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

  async generateAccountData(
    count = 1,
    requestConfig,
    model,
    categories = [],
    selectedLanguages = ['en-US'],
    options = {}
  ) {
    const { logger, prompt } = this.ctx;
    const correlationId = requestConfig?.correlationId;
    try {
      const langs =
        Array.isArray(selectedLanguages) && selectedLanguages.length
          ? selectedLanguages
          : ['en-US'];

      const languageCodes = langs.map((l) => l.replace('-', '_'));

      const vars = {
        brandName: options.brandName || '',
        count,
        pluralSuffix: pluralize(count),
        categories: categories.join(', '),
        languageList: joinList(langs),
        languageCodesCSV: languageCodes.join(', '),
      };

      const promptContent = await prompt.render('account', vars, requestConfig);
      return await this._chatJson(
        'account',
        promptContent,
        requestConfig,
        model,
        'account'
      );
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

  async generateOrderData(
    products,
    accounts,
    count = 1,
    requestConfig,
    model,
    selectedLanguages = ['en-US'],
    options = {}
  ) {
    const { logger, prompt } = this.ctx;
    const correlationId = requestConfig?.correlationId;
    try {
      const langs =
        Array.isArray(selectedLanguages) && selectedLanguages.length
          ? selectedLanguages
          : ['en-US'];

      const languageCodes = langs.map((l) => l.replace('-', '_'));

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
        brandName: options.brandName || '',
        count,
        pluralSuffix: pluralize(count),
        productListJSON: JSON.stringify(productList, null, 2),
        accountListJSON: JSON.stringify(accountList, null, 2),
        languageList: joinList(langs),
        languageCodesCSV: languageCodes.join(', '),
      };

      const promptContent = await prompt.render('order', vars, requestConfig);
      return await this._chatJson(
        'order',
        promptContent,
        requestConfig,
        model,
        'order'
      );
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

  async generateWarehouseData(
    count = 1,
    requestConfig,
    model,
    selectedLanguages = ['en-US'],
    options = {}
  ) {
    const { logger, prompt } = this.ctx;
    const correlationId = requestConfig?.correlationId;
    try {
      const langs =
        Array.isArray(selectedLanguages) && selectedLanguages.length
          ? selectedLanguages
          : ['en-US'];

      const languageCodes = langs.map((l) => l.replace('-', '_'));

      const vars = {
        brandName: options.brandName || '',
        count,
        pluralSuffix: pluralize(count),
        languageList: joinList(langs),
        languageCodesCSV: languageCodes.join(', '),
      };

      const promptContent = await prompt.render(
        'warehouse',
        vars,
        requestConfig
      );
      return await this._chatJson(
        'warehouse',
        promptContent,
        requestConfig,
        model,
        'warehouse'
      );
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('AIService.generateWarehouseData failed', {
        correlationId,
        errorReference,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

      const wrapped = new Error(
        `AI service error: ${
          error.message || 'Failed to generate warehouse data'
        }`
      );
      wrapped.errorReference = errorReference;
      throw wrapped;
    }
  }

  async generateImageDataForProduct(product, options) {
    const { logger } = this.ctx;
    const correlationId = options?.correlationId;

    try {
      const openai = await this.getOpenAIClient(options);

      const prompt = `A high-quality, professional product photograph of a ${
        product.name?.en_US || product.name
      }, which is a ${
        product.description?.en_US || product.description
      }. The product belongs to the category: ${
        product.category
      }. The image should be in a ${
        options.imageStyle || 'photographic'
      } style on a clean background.`;

      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: `${options.imageWidth || 1024}x${options.imageHeight || 1024}`,
        quality: options.imageQuality || 'standard',
        response_format: 'b64_json',
      });

      return response.data[0].b64_json;
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('AIService.generateImageDataForProduct failed', {
        correlationId,
        errorReference,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

      const wrapped = new Error(
        `AI service error: ${error.message || 'Failed to generate image data'}`
      );
      wrapped.errorReference = errorReference;
      throw wrapped;
    }
  }

  async generatePricingData(
    products,
    pricingType = 'standard',
    requestConfig,
    model,
    selectedLanguages = ['en-US']
  ) {
    const { logger, prompt } = this.ctx;
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

      const promptContent = await prompt.render('pricing', vars, requestConfig);
      return await this._chatJson(
        'pricing',
        promptContent,
        requestConfig,
        model,
        'pricing'
      );
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
