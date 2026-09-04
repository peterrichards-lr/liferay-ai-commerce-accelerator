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
const { estimateTokens } = require('../utils/tokenEstimator.cjs');

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

  async initializeSchemas() {
    const schemasDir = path.join(__dirname, '../generation-schemas');
    try {
      if (!fs.existsSync(schemasDir)) {
        return;
      }
      const files = await fs.promises.readdir(schemasDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const schemaName = path.basename(file, '.json');
          const schemaPath = path.join(schemasDir, file);
          const content = await fs.promises.readFile(schemaPath, 'utf8');
          const schema = JSON.parse(content);
          this.localSchemas[schemaName] = this.ajv.compile(schema);
        }
      }
      this.ctx.logger?.info(
        '[AIService] SUCCESS: Pre-compiled all validation schemas'
      );
    } catch (err) {
      this.ctx.logger?.error(
        `[AIService] Failed to initialize schemas: ${err.message}`
      );
    }
  }

  _validateResponse(data, schemaName) {
    if (!schemaName) return data;

    const validator = this.localSchemas[schemaName];
    if (validator) {
      const mainPropertyName = schemaName + 's';
      const toValidate = Array.isArray(data)
        ? { [mainPropertyName]: data }
        : data;
      const isValid = validator(toValidate);
      if (!isValid) {
        this.ctx.logger.error(
          `AI generated data for ${schemaName} violates internal schema`,
          {
            errors: validator.errors,
          }
        );
      }
    } else {
      this.ctx.logger?.warn(
        `[AIService] Validation schema "${schemaName}" not found or not pre-compiled`
      );
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

    const chunkSizes =
      typeof config.getAIChunkSizes === 'function'
        ? await config.getAIChunkSizes(requestConfig)
        : { product: 10, account: 10, order: 10, warehouse: 10 };

    return {
      provider,
      mediaProvider,
      credentials: { apiKey },
      mediaCredentials: { apiKey: mediaApiKey },
      model,
      temperature,
      maxTokens,
      requestTimeoutMs,
      chunkSizes,
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

      // Pre-flight Token Estimator Guardrail
      const systemInstruction = `You are an expert AI generator for ${task} data. Return only valid JSON.${
        schema
          ? `\n\nThe JSON output must conform to the following schema:\n\n${JSON.stringify(schema)}`
          : ''
      }`;
      const fullPromptText = `${systemInstruction}\n\n${prompt}`;
      const estimatedTokens = estimateTokens(fullPromptText, runtime.model);
      const limit = parseInt(process.env.AICA_MAX_TOKEN_LIMIT, 10) || 15000;

      if (
        estimatedTokens > limit &&
        process.env.ALLOW_LARGE_PROMPTS !== 'true'
      ) {
        const tokenErr = new Error(
          `Pre-flight Guardrail Aborted: Estimated prompt token size (${estimatedTokens} tokens) exceeds the safety threshold limit of ${limit} tokens. Please reduce your generation sizes, or set ALLOW_LARGE_PROMPTS=true in your environment to bypass.`
        );
        tokenErr.statusCode = 400;
        throw tokenErr;
      }

      const effectiveMaxTokens =
        runtime.maxTokens === 4000 ? 16384 : runtime.maxTokens || 16384;

      const parsed = await provider.generateJSON(
        task,
        prompt,
        {
          ...runtime,
          maxTokens: effectiveMaxTokens,
          model: model || runtime.model,
        },
        schema
      );

      if (parsed === null || typeof parsed !== 'object') {
        throw new Error(
          `AIService._chatJson received non-JSON or unparseable response for task "${task}"`
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

      const runtime = await this.getRuntimeAIConfig(requestConfig);
      const effectiveChunkSize = Math.max(
        1,
        Math.min(50, runtime?.chunkSizes?.product || runtime?.chunkSize || 5)
      );

      if (count > effectiveChunkSize) {
        const chunks = [];
        let remaining = count;
        while (remaining > 0) {
          chunks.push(Math.min(remaining, effectiveChunkSize));
          remaining -= effectiveChunkSize;
        }

        logger?.info?.(
          `[AIService] Chunking product generation: ${count} products into ${chunks.length} chunks (chunkSize: ${effectiveChunkSize})`,
          { count, chunksCount: chunks.length, correlationId }
        );

        const allProducts = [];
        const categoriesList =
          Array.isArray(options.categories) && options.categories.length > 0
            ? options.categories
            : [category || 'General'];

        for (let i = 0; i < chunks.length; i++) {
          const chunkCount = chunks[i];
          const chunkCategory = categoriesList[i % categoriesList.length];
          logger?.info?.(
            `[AIService] Generating product chunk ${i + 1}/${chunks.length} (${chunkCount} items, category: ${chunkCategory})...`,
            {
              chunkIndex: i + 1,
              totalChunks: chunks.length,
              chunkCount,
              correlationId,
            }
          );

          const chunkResult = await this.generateProductData(
            chunkCategory,
            chunkCount,
            requestConfig,
            model,
            selectedLanguages,
            { ...options, categories: [chunkCategory] }
          );

          const chunkItems = Array.isArray(chunkResult)
            ? chunkResult
            : chunkResult?.products || [];
          allProducts.push(...chunkItems);
        }

        return allProducts;
      }

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
            - promoPrice (number or null): The promotional price for this entry. Generate this for approximately 20% of products, otherwise null.
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

      const accountType = options.accountType || 'business';
      const ratio = options.businessAccountRatio;

      // Split by ratio BEFORE chunking, not within each chunk. Splitting inside
      // the chunk loop would round separately per chunk, so the totals would
      // drift from the requested ratio; doing it once here keeps the split exact.
      // Each portion then recurses with a concrete accountType, which picks up
      // chunking on the way through rather than reimplementing it.
      if (
        accountType === 'mixed' &&
        typeof ratio === 'number' &&
        Number.isFinite(ratio) &&
        count > 0
      ) {
        const businessCount = Math.round(count * ratio);
        const personCount = count - businessCount;

        logger?.info?.(
          `[AIService] Splitting mixed accounts by ratio ${ratio}: ${businessCount} business, ${personCount} person`,
          { count, businessCount, personCount, correlationId }
        );

        const splitResults = [];
        for (const [portionType, portionCount] of [
          ['business', businessCount],
          ['person', personCount],
        ]) {
          if (portionCount <= 0) continue;

          const portion = await this.generateAccountData(
            portionCount,
            requestConfig,
            model,
            categories,
            selectedLanguages,
            {
              ...options,
              accountType: portionType,
              businessAccountRatio: undefined,
            }
          );

          splitResults.push(
            ...(Array.isArray(portion) ? portion : portion?.accounts || [])
          );
        }

        return splitResults;
      }

      const runtime = await this.getRuntimeAIConfig(requestConfig);
      const effectiveChunkSize = Math.max(
        1,
        Math.min(50, runtime?.chunkSizes?.account || runtime?.chunkSize || 10)
      );

      if (count > effectiveChunkSize) {
        const chunks = [];
        let remaining = count;
        while (remaining > 0) {
          chunks.push(Math.min(remaining, effectiveChunkSize));
          remaining -= effectiveChunkSize;
        }

        logger?.info?.(
          `[AIService] Chunking account generation: ${count} accounts into ${chunks.length} chunks (chunkSize: ${effectiveChunkSize})`,
          { count, chunksCount: chunks.length, correlationId }
        );

        const allAccounts = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkCount = chunks[i];
          logger?.info?.(
            `[AIService] Generating account chunk ${i + 1}/${chunks.length} (${chunkCount} items)...`,
            {
              chunkIndex: i + 1,
              totalChunks: chunks.length,
              chunkCount,
              correlationId,
            }
          );

          const chunkResult = await this.generateAccountData(
            chunkCount,
            requestConfig,
            model,
            categories,
            selectedLanguages,
            options
          );

          const items = Array.isArray(chunkResult)
            ? chunkResult
            : chunkResult?.accounts || [];
          allAccounts.push(...items);
        }

        return allAccounts;
      }

      const vars = {
        brandName: options.brandName || '',
        count,
        pluralSuffix: pluralize(count),
        categories: categories.join(', '),
        languageList: joinList(langs),
        languageCodesCSV: languageCodes.join(', '),
        geographicContext: options.geographicContext || null,
        groundingMetadata: options.groundingMetadata || null,
        accountType,
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

      const runtime = await this.getRuntimeAIConfig(requestConfig);
      const effectiveChunkSize = Math.max(
        1,
        Math.min(50, runtime?.chunkSizes?.order || runtime?.chunkSize || 10)
      );

      if (count > effectiveChunkSize) {
        const chunks = [];
        let remaining = count;
        while (remaining > 0) {
          chunks.push(Math.min(remaining, effectiveChunkSize));
          remaining -= effectiveChunkSize;
        }

        logger?.info?.(
          `[AIService] Chunking order generation: ${count} orders into ${chunks.length} chunks (chunkSize: ${effectiveChunkSize})`,
          { count, chunksCount: chunks.length, correlationId }
        );

        const allOrders = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkCount = chunks[i];
          logger?.info?.(
            `[AIService] Generating order chunk ${i + 1}/${chunks.length} (${chunkCount} items)...`,
            {
              chunkIndex: i + 1,
              totalChunks: chunks.length,
              chunkCount,
              correlationId,
            }
          );

          const chunkResult = await this.generateOrderData(
            products,
            accounts,
            chunkCount,
            requestConfig,
            model,
            selectedLanguages,
            options
          );

          const items = Array.isArray(chunkResult)
            ? chunkResult
            : chunkResult?.orders || [];
          allOrders.push(...items);
        }

        return allOrders;
      }

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
        orderDateRangeDays: Number(options.orderDateRangeDays) || 0,
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

      const runtime = await this.getRuntimeAIConfig(requestConfig);
      const effectiveChunkSize = Math.max(
        1,
        Math.min(50, runtime?.chunkSizes?.warehouse || runtime?.chunkSize || 10)
      );

      if (count > effectiveChunkSize) {
        const chunks = [];
        let remaining = count;
        while (remaining > 0) {
          chunks.push(Math.min(remaining, effectiveChunkSize));
          remaining -= effectiveChunkSize;
        }

        logger?.info?.(
          `[AIService] Chunking warehouse generation: ${count} warehouses into ${chunks.length} chunks (chunkSize: ${effectiveChunkSize})`,
          { count, chunksCount: chunks.length, correlationId }
        );

        const allWarehouses = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkCount = chunks[i];
          logger?.info?.(
            `[AIService] Generating warehouse chunk ${i + 1}/${chunks.length} (${chunkCount} items)...`,
            {
              chunkIndex: i + 1,
              totalChunks: chunks.length,
              chunkCount,
              correlationId,
            }
          );

          const chunkResult = await this.generateWarehouseData(
            chunkCount,
            requestConfig,
            model,
            selectedLanguages,
            options
          );

          const items = Array.isArray(chunkResult)
            ? chunkResult
            : chunkResult?.warehouses || [];
          allWarehouses.push(...items);
        }

        return allWarehouses;
      }

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
      // Pricing is driven by the size of the product list rather than by a
      // requested count, so it chunks the INPUT rather than splitting an output
      // total the way product/account/order/warehouse do. A large catalogue
      // otherwise produces one enormous productListJSON and the response is
      // truncated.
      const runtime = await this.getRuntimeAIConfig(requestConfig);
      const effectiveChunkSize = Math.max(
        1,
        Math.min(50, runtime?.chunkSizes?.pricing || runtime?.chunkSize || 10)
      );

      if (Array.isArray(products) && products.length > effectiveChunkSize) {
        const batches = [];
        for (let i = 0; i < products.length; i += effectiveChunkSize) {
          batches.push(products.slice(i, i + effectiveChunkSize));
        }

        logger?.info?.(
          `[AIService] Chunking pricing generation: ${products.length} products into ${batches.length} chunks (chunkSize: ${effectiveChunkSize})`,
          { count: products.length, chunksCount: batches.length, correlationId }
        );

        const allEntries = [];
        let priceListName;

        for (let i = 0; i < batches.length; i++) {
          logger?.info?.(
            `[AIService] Generating pricing chunk ${i + 1}/${batches.length} (${batches[i].length} products)...`,
            {
              chunkIndex: i + 1,
              totalChunks: batches.length,
              chunkCount: batches[i].length,
              correlationId,
            }
          );

          const chunkResult = await this.generatePricingData(
            batches[i],
            pricingType,
            requestConfig,
            model,
            _selectedLanguages,
            options
          );

          const entries = Array.isArray(chunkResult)
            ? chunkResult
            : chunkResult?.priceEntries || [];
          allEntries.push(...entries);

          // priceListName is a property of the list as a whole, not of a chunk;
          // keep the first non-empty one so the merged result stays valid
          // against the schema, which requires it.
          if (!priceListName && chunkResult?.priceListName) {
            priceListName = chunkResult.priceListName;
          }
        }

        return { priceEntries: allEntries, priceListName };
      }

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

  async generatePromoData(
    products = [],
    accounts = [],
    _options = {},
    requestConfig = {}
  ) {
    const { logger, prompt } = this.ctx;
    const correlationId = requestConfig.correlationId || 'system';

    try {
      const productList = products.map((p) => ({
        name: p.name?.en_US || p.name,
        sku: p.sku || p.externalReferenceCode,
        id: p.id,
      }));

      const accountList = accounts.map((a) => ({
        name: a.name,
        externalReferenceCode: a.externalReferenceCode,
        id: a.id,
      }));

      const vars = {
        productListJSON: JSON.stringify(productList, null, 2),
        accountListJSON: JSON.stringify(accountList, null, 2),
      };

      const promptContent = await prompt.render('promo', vars, requestConfig);
      return await this._chatJson(
        'promo',
        promptContent,
        requestConfig,
        undefined,
        'promo'
      );
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('AIService.generatePromoData failed', {
        correlationId,
        errorReference,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

      const wrapped = new Error(
        `AI service error: ${error.message || 'Failed to generate promo data'}`
      );
      wrapped.errorReference = errorReference;
      throw wrapped;
    }
  }
}

module.exports = { AIService };
