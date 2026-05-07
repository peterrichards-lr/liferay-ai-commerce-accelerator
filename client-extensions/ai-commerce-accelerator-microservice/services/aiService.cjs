const AIProviderFactory = require('./ai-providers/providerFactory.cjs');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');
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
    this.factory = new AIProviderFactory(ctx);

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

    const provider = aiCfg.provider || 'openai';
    const mediaProvider = aiCfg.mediaProvider || provider;

    const apiKey =
      requestConfig?.aiApiKey || (await config.getAIKey(requestConfig));

    let mediaApiKey = requestConfig?.aiMediaApiKey;

    if (!mediaApiKey) {
      if (mediaProvider === 'inherit') {
        mediaApiKey = apiKey;
      } else {
        mediaApiKey = (await config.getAIMediaKey(requestConfig)) || apiKey;
      }
    }

    if (!aiCfg.defaultModel) {
      const err = new Error(
        `AI model not configured for provider ${provider}.`
      );
      err.statusCode = 400;
      throw err;
    }

    const model = aiCfg.defaultModel;
    const temperature =
      typeof aiCfg.temperature === 'number' ? aiCfg.temperature : 0.7;
    const maxTokens =
      (aiCfg.maxTokens && aiCfg.maxTokens.default) || aiCfg.maxTokens || 4000;
    const requestTimeoutMs =
      typeof aiCfg.requestTimeoutMs === 'number'
        ? aiCfg.requestTimeoutMs
        : 60000;

    return {
      provider,
      mediaProvider,
      credentials: { apiKey },
      mediaCredentials: { apiKey: mediaApiKey },
      model,
      temperature,
      maxTokens,
      requestTimeoutMs,
    };
  }

  async getAIProvider(requestConfig, type = 'text') {
    const runtime = await this.getRuntimeAIConfig(requestConfig);
    const providerName =
      type === 'media' ? runtime.mediaProvider : runtime.provider;
    return this.factory.getProvider(providerName);
  }

  async _chatJson(task, prompt, requestConfig, model, schemaName) {
    const { logger, config } = this.ctx;
    try {
      const provider = await this.getAIProvider(requestConfig, 'text');
      const runtime = await this.getRuntimeAIConfig(requestConfig);

      const schema = schemaName
        ? await config.getAISchema(requestConfig, schemaName)
        : null;

      const parsed = await provider.generateJSON(
        task,
        prompt,
        {
          ...runtime,
          model: model || runtime.model,
        },
        schema
      );

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

  async generatePDFContent(
    product,
    category,
    requestConfig,
    model,
    options = {}
  ) {
    const { logger, prompt } = this.ctx;
    const correlationId = requestConfig?.correlationId;
    try {
      const vars = {
        brandName: options.brandName || '',
        productName: product.name?.en_US || product.name,
        productDescription: product.description?.en_US || product.description,
        category,
        contentType: options.pdfContentType || 'product_info',
        contentTypeLabel: {
          product_info: 'detailed product information',
          user_guide: 'a step-by-step user guide',
          compliance: 'compliance and regulatory documentation',
          technical_specs: 'technical specifications and data sheet',
        }[options.pdfContentType || 'product_info'],
        specificationsJSON: JSON.stringify(
          product.specifications || {},
          null,
          2
        ),
        groundingMetadata: options.groundingMetadata || null,
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
        groundingMetadata: options.groundingMetadata || null,
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
        geographicContext: options.geographicContext || null,
        groundingMetadata: options.groundingMetadata || null,
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
        groundingMetadata: options.groundingMetadata || null,
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
        geographicContext: options.geographicContext || null,
        groundingMetadata: options.groundingMetadata || null,
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
      const provider = await this.getAIProvider(options, 'media');
      const runtime = await this.getRuntimeAIConfig(options);

      return await provider.generateImage(product, {
        ...runtime,
        credentials: runtime.mediaCredentials, // USE MEDIA CREDENTIALS
        ...options,
      });
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
    _selectedLanguages = ['en-US'],
    options = {}
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
        brandName: options.brandName || '',
        pricingType,
        productListJSON: JSON.stringify(productList, null, 2),
        ...pricingHints(pricingType),
        groundingMetadata: options.groundingMetadata || null,
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
