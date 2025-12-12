const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const OpenAI = require('openai');
const {
  pluralize,
  pricingHints,
  joinList,
} = require('../utils/promptHelpers.cjs');
const { createERC, tryParseJSON } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

const ajv = new Ajv({ removeAdditional: true });
addFormats(ajv);

class AIService {
  constructor(ctx) {
    this.ctx = ctx;
    this.openai = null;

    this.defaultModel = null;
    this.defaultTemperature = 0.7;
    this.maxTokens = 4000;
    this.requestTimeoutMs = 60000;
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
    const { configService } = this.ctx;
    const aiCfg = (await configService.getAIConfig(requestConfig)) || {};

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

  async _chatJson(task, prompt, requestConfig, model, schemaName) {
    const { logger, configService } = this.ctx;
    try {
      const openai = await this.getOpenAIClient(requestConfig);
      const runtime = await this.getRuntimeAIConfig(requestConfig);

      const schema = schemaName
        ? await configService.getAISchema(requestConfig, schemaName)
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
        });
      }

      const parsed = tryParseJSON(content, null);

      if (logger && logger.trace && parsed !== null) {
        logger.trace('AIService._chatJson parsed response preview', {
          task,
          parsedPreview: Array.isArray(parsed) ? parsed.slice(0, 3) : parsed,
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

      if (logger && logger.trace && processedCandidate !== null) {
        logger.trace('AIService._chatJson parsed response preview', {
          task,
          parsedPreview: Array.isArray(processedCandidate)
            ? processedCandidate.slice(0, 3)
            : processedCandidate,
        });
      }

      if (schema) {
        const validate = ajv.compile(schema);
        const valid = validate(processedCandidate);

        if (!valid) {
          if (logger && logger.trace) {
            logger.trace('AIService._chatJson schema validation failed', {
              task,
              errors: validate.errors,
              validatedCandidate: JSON.stringify(processedCandidate, null, 2),
            });
          }

          const err = new Error(
            `AI output for task "${task}" failed schema validation.`
          );
          err.errors = validate.errors;
          throw err;
        }

        const mainPropertyName = schemaName + 's';
        if (
          schema.properties &&
          schema.properties[mainPropertyName] &&
          Array.isArray(processedCandidate[mainPropertyName])
        ) {
          return processedCandidate[mainPropertyName];
        }

        if (schema.type === 'array' && Array.isArray(processedCandidate)) {
          return processedCandidate;
        }
        return processedCandidate;
      }

      return processedCandidate;
    } catch (error) {
      logger?.error?.(`AIService._chatJson failed for ${task}:`, {
        message: error.message,
        stack: error.stack,
        errors: error.errors,
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

      const prompt = await promptService.render('pdf', vars, requestConfig);
      return await this._chatJson('pdf', prompt, requestConfig, model, 'pdf');
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

      const prompt = await promptService.render('product', vars, requestConfig);
      const result = await this._chatJson(
        'product',
        prompt,
        requestConfig,
        model,
        'product'
      );

      const products = Array.isArray(result)
        ? result
        : result.products || [result];

      return products;
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

      const prompt = await promptService.render('account', vars, requestConfig);
      const result = await this._chatJson(
        'account',
        prompt,
        requestConfig,
        model,
        'account'
      );

      const accounts = Array.isArray(result)
        ? result
        : result.accounts || [result];

      return accounts;
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

      const prompt = await promptService.render('order', vars, requestConfig);
      const result = await this._chatJson(
        'order',
        prompt,
        requestConfig,
        model,
        'order'
      );

      const orders = Array.isArray(result) ? result : result.orders || [result];

      return orders;
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

  async generateWarehouseData(count = 1, requestConfig, model) {
    const { logger, promptService } = this.ctx;
    const correlationId = requestConfig?.correlationId;
    try {
      const vars = {
        count,
        pluralSuffix: pluralize(count),
      };

      const prompt = await promptService.render(
        'warehouse',
        vars,
        requestConfig
      );
      const result = await this._chatJson(
        'warehouse',
        prompt,
        requestConfig,
        model,
        'warehouse'
      );

      const warehouses = Array.isArray(result)
        ? result
        : result.warehouses || [result];

      return warehouses;
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

      const prompt = await promptService.render('pricing', vars, requestConfig);
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
