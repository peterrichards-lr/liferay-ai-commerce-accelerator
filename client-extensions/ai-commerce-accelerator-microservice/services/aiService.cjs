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
const { modelProviderIssue } = require('../utils/modelCatalog.cjs');
const { apiKeyIssue } = require('../utils/apiKeys.cjs');
const { resolveMaxTokens } = require('../utils/aiRequestOptions.cjs');
const {
  dropNullTypeViolations,
  expandOpenMapsForPrompt,
} = require('../utils/schemaProjection.cjs');

/**
 * The schemas whose response nothing downstream validates.
 *
 * Every generation entity is handed to GenerationFacade, which converts the
 * wire format back (`_standardize`), fills in the identifiers and defaults it
 * owns, and only then runs the generation schema over the result - feeding
 * ajv's errors back for a retry and failing the step if the second attempt is
 * no better. Running the same schema here as well judged the response against a
 * shape it had deliberately not been asked for: `skuVariants[].options` arrives
 * as name/value pairs, and the ids, ERCs and prices GenerationFacade assigns do
 * not exist yet. Correct runs logged hundreds of violations, which is how a
 * genuine one would have gone unread. See #760.
 *
 * `pdf` is the exception. MediaGenerator renders that response into a document
 * itself, so this is the only gate it passes.
 */
const RESPONSE_GATED_SCHEMAS = new Set(['pdf']);

// Extra generation rounds allowed to close a shortfall. Two is enough for the
// nine-instead-of-ten case without turning a stubborn model into a cost sink.
// A top-up asks for at most one chunk, so closing a large gap needs roughly
// one attempt per missing chunk. Two was sized for "asked for ten, got nine"
// and could not close a gap of thirty-four however many items each round
// returned: two attempts add at most two chunks, by construction (#759).
//
// Budgeted from the chunk count instead, so the ceiling scales with the run,
// and capped so a model that keeps returning one item cannot bill for a
// hundred rounds. A round that adds nothing still breaks out immediately,
// which is what stops this being expensive in the case that matters.
const TOPUP_ATTEMPTS = 2;
const TOPUP_ATTEMPTS_MAX = 10;

function topUpBudget(chunkCount) {
  return Math.min(TOPUP_ATTEMPTS_MAX, Math.max(TOPUP_ATTEMPTS, chunkCount));
}
const { resolveMediaProvider } = require('../utils/providerCapabilities.cjs');
const { ENV, ERC_PREFIX } = require('../utils/constants.cjs');
const { estimateTokens } = require('../utils/tokenEstimator.cjs');
const { shareCount } = require('../utils/shareSelection.cjs');
const { createProductLedger } = require('../utils/productLedger.cjs');
const {
  accountGeography,
  accountTypeGuidance,
  avoidProductsGuidance,
  brandGuidance,
  currencyGuidance,
  languageGuidance,
  orderDateGuidance,
  vocabularyGuidance,
  warehouseGeography,
} = require('../utils/promptContext.cjs');

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
        const schemaName = path.basename(file, '.json');

        // The rest are compiled by GenerationFacade, which is where they are
        // applied; compiling them here as well only invited them to be used
        // here as well.
        if (
          !file.endsWith('.json') ||
          !RESPONSE_GATED_SCHEMAS.has(schemaName)
        ) {
          continue;
        }

        const schemaPath = path.join(schemasDir, file);
        const content = await fs.promises.readFile(schemaPath, 'utf8');
        const schema = JSON.parse(content);
        this.localSchemas[schemaName] = this.ajv.compile(schema);
      }
      this.ctx.logger?.info(
        '[AIService] SUCCESS: Pre-compiled the gated response schemas'
      );
    } catch (err) {
      this.ctx.logger?.error(
        `[AIService] Failed to initialize schemas: ${err.message}`
      );
    }
  }

  /**
   * @throws {Error} when a gated response cannot be made to satisfy its schema.
   */
  _validateResponse(data, schemaName) {
    if (!RESPONSE_GATED_SCHEMAS.has(schemaName)) return data;

    const validator = this.localSchemas[schemaName];

    if (!validator) {
      this.ctx.logger?.warn?.(
        `[AIService] Validation schema "${schemaName}" not found or not pre-compiled`
      );
      return data;
    }

    if (validator(data)) return data;

    // OpenAI's strict mode has no way to say "optional" other than a union with
    // null, so `pdf.externalReferenceCode` comes back as null on every call
    // through that provider. Repaired the same way GenerationFacade repairs it,
    // then judged - otherwise this gate would reject every PDF it was given.
    if (
      dropNullTypeViolations(data, validator.errors).length > 0 &&
      validator(data)
    ) {
      return data;
    }

    const message = `AI generated data for ${schemaName} does not satisfy its generation schema`;

    this.ctx.logger?.error?.(message, { errors: validator.errors });

    // Thrown rather than logged and passed on. MediaGenerator's renderer
    // substitutes a placeholder title and one boilerplate section for whatever
    // is missing, so returning an invalid response attaches a document that
    // looks like product documentation and contains none of it. The caller
    // already catches per product, so the item is dropped, counted as a failed
    // attachment and the rest of the run continues.
    const error = new Error(message);
    error.errors = validator.errors;
    error.errorReference = createERC(ERC_PREFIX.ERROR);

    throw error;
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
    // Raw value, kept because 'inherit' also means "reuse the core API key".
    const mediaProvider = aiCfg.mediaProvider || provider;
    // The provider actually asked for images. 'inherit' is a configuration
    // sentinel, not a provider name, so it must never reach the factory.
    const effectiveMediaProvider = resolveMediaProvider(
      provider,
      aiCfg.mediaProvider
    );

    const apiKey =
      requestConfig?.aiApiKey ||
      (await config.getAIKey(requestConfig, provider));

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

    // The model list is runtime data and the provider is chosen separately, so
    // the two can disagree. Reported here, where both are known, rather than
    // left to the provider: openaiProvider would 404 midway through a run and
    // anthropicProvider would silently substitute its own default.
    // Optional, matching getAIChunkSizes below. Without the list the check
    // falls back to inferring the provider from the model id, which still
    // catches every model this build ships.
    const modelOptions =
      typeof config.getAIModelOptions === 'function'
        ? (await config.getAIModelOptions(requestConfig))?.aiModelOptions
        : null;
    const mismatch = modelProviderIssue(provider, model, modelOptions || []);

    if (mismatch) {
      const err = new Error(mismatch);
      err.statusCode = 400;
      throw err;
    }

    // Refuse before the credential leaves the process. The key is resolved
    // generically, so nothing else stops an OpenAI key being sent to
    // api.anthropic.com, where it would be disclosed to a third party and come
    // back as an ordinary authentication error.
    const keyIssue = apiKeyIssue(provider, apiKey);

    if (keyIssue) {
      const err = new Error(keyIssue);
      err.statusCode = 400;
      throw err;
    }

    const mediaKeyIssue = apiKeyIssue(effectiveMediaProvider, mediaApiKey);

    if (mediaKeyIssue) {
      const err = new Error(mediaKeyIssue);
      err.statusCode = 400;
      throw err;
    }
    const temperature =
      typeof aiCfg.temperature === 'number' ? aiCfg.temperature : 0.7;
    // The only place the configured cap is resolved, so a value set in the
    // panel is the value sent. `maxTokens` is a per-task map whose `default`
    // key is the one read; configuration written before that map existed is a
    // bare number, which is why both shapes are accepted.
    const maxTokens = resolveMaxTokens(
      aiCfg.maxTokens && typeof aiCfg.maxTokens === 'object'
        ? aiCfg.maxTokens.default
        : aiCfg.maxTokens
    );

    // A positive number or null, so "not configured" is distinguishable from
    // "configured as zero" and cannot silently win a ?? chain.
    const positive = (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    // Resolved as a chain rather than a single source, because the ai-config
    // object lives in the Liferay the client extensions are deployed to, while
    // a run may target a different instance. Against such a target aiCfg is the
    // apiKey-only fallback, which carries no requestTimeoutMs at all - so every
    // AI setting used to land on its hardcoded default with no way to override
    // it from anywhere. See #762.
    //
    // Request first: a per-run value is the only layer that is safe on a shared
    // deployment, where ENV is one value for every user of the server.
    const requestTimeoutMs =
      positive(requestConfig?.requestTimeoutMs) ??
      (typeof aiCfg.requestTimeoutMs === 'number'
        ? aiCfg.requestTimeoutMs
        : null) ??
      ENV.AI_REQUEST_TIMEOUT_MS ??
      60000;

    const configuredChunkSizes =
      typeof config.getAIChunkSizes === 'function'
        ? await config.getAIChunkSizes(requestConfig)
        : { product: 10, account: 10, order: 10, warehouse: 10 };

    // ENV outranks the stored value here, unlike the timeout above, because
    // getAIChunkSizes substitutes its own { product: 10, ... } when the target
    // holds nothing. That makes an absent setting indistinguishable from a
    // deliberate 10, so an ENV layer placed below it could never take effect.
    const envChunkSizes = {
      account: ENV.AI_CHUNK_SIZE_ACCOUNT,
      order: ENV.AI_CHUNK_SIZE_ORDER,
      pricing: ENV.AI_CHUNK_SIZE_PRICING,
      product: ENV.AI_CHUNK_SIZE_PRODUCT,
      warehouse: ENV.AI_CHUNK_SIZE_WAREHOUSE,
    };
    const requestChunkSizes = requestConfig?.chunkSizes || {};
    const chunkSizes = { ...configuredChunkSizes };

    for (const task of Object.keys(envChunkSizes)) {
      const resolved =
        positive(requestChunkSizes[task]) ??
        envChunkSizes[task] ??
        positive(configuredChunkSizes?.[task]);

      if (resolved !== null) chunkSizes[task] = resolved;
    }

    return {
      provider,
      mediaProvider: effectiveMediaProvider,
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

  /**
   * @param {string[]} [languages] - The run's selectedLanguages. Passed on to
   *   the provider so the locale-keyed maps in the generation schema can be
   *   expanded into named properties for structured output; without them an
   *   open map cannot be expressed and the provider falls back to describing
   *   the schema in the prompt. See #633.
   */
  async _chatJson(task, prompt, requestConfig, model, schemaName, languages) {
    const { logger, config } = this.ctx;
    try {
      const provider = await this.getAIProvider(requestConfig, 'text');
      const runtime = await this.getRuntimeAIConfig(requestConfig);

      const schema = schemaName
        ? await config.getAISchema(requestConfig, schemaName)
        : null;

      // Pre-flight Token Estimator Guardrail. Estimated against the schema
      // as the provider would describe it in the prompt, which is the largest
      // of the shapes it may send - a provider that sends the schema as a
      // structured output sends no prose copy of it at all.
      const systemInstruction = `You are an expert AI generator for ${task} data. Return only valid JSON.${
        schema
          ? `\n\nThe JSON output must conform to the following schema:\n\n${JSON.stringify(
              expandOpenMapsForPrompt(schema, languages)
            )}`
          : ''
      }`;

      // Appended when a previous attempt failed schema validation, so a retry
      // is a correction rather than the same request sent again. Placed after
      // the prompt so it is the last thing the model reads. See #633.
      const feedback = requestConfig?.validationFeedback;
      const effectivePrompt = feedback ? `${prompt}\n\n${feedback}` : prompt;

      const fullPromptText = `${systemInstruction}\n\n${effectivePrompt}`;
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

      // Logged because the cap is otherwise invisible until a response comes
      // back: a request that times out or is refused never reaches the token
      // usage the providers log, and the panel's number was for a long time
      // not the number sent (#823).
      logger?.debug?.(`AIService: max_tokens for ${task}`, {
        maxTokens: runtime.maxTokens,
        task,
      });

      // No substitution here. The cap arrives resolved on `runtime` and is
      // spread through as configured; it used to be compared against 4000 -
      // the value the product shipped with - and replaced with 16384 whenever
      // it matched, so tuning the panel moved the real cap the other way.
      const parsed = await provider.generateJSON(
        task,
        effectivePrompt,
        {
          ...runtime,
          languages,
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
        brandGuidance: brandGuidance(
          options.brandName,
          "The generated document should reflect this brand's voice and style."
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
        // The chunk loop used to accumulate blind, so only the top-up rounds
        // deduplicated and a repeat between two chunks went straight through.
        // One ledger for both loops makes its rule the run's only rule (#798).
        const ledger = createProductLedger();
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
            {
              ...options,
              avoidProducts: ledger.avoid(),
              categories: [chunkCategory],
            }
          );

          const chunkItems = Array.isArray(chunkResult)
            ? chunkResult
            : chunkResult?.products || [];

          // A chunk whose response has an unexpected shape falls through to []
          // and silently loses every item in it - 50 requested arriving as 40
          // with nothing in the log to say so. Report what each chunk actually
          // returned, and say plainly when it is short.
          if (chunkItems.length !== chunkCount) {
            logger?.warn?.(
              `[AIService] Product chunk ${i + 1}/${chunks.length} returned ${chunkItems.length} of ${chunkCount} requested items`,
              {
                chunkIndex: i + 1,
                requested: chunkCount,
                received: chunkItems.length,
                resultShape: Array.isArray(chunkResult)
                  ? 'array'
                  : chunkResult && typeof chunkResult === 'object'
                    ? Object.keys(chunkResult).join(',') || 'empty-object'
                    : typeof chunkResult,
                correlationId,
              }
            );
          }

          let kept = 0;

          for (const product of chunkItems) {
            if (ledger.add(product)) {
              allProducts.push(product);
              kept++;
            }
          }

          if (kept < chunkItems.length) {
            logger?.info?.(
              `[AIService] Product chunk ${i + 1}/${chunks.length} repeated ${chunkItems.length - kept} product(s) an earlier chunk already generated; they were discarded`,
              {
                chunkIndex: i + 1,
                discarded: chunkItems.length - kept,
                kept,
                correlationId,
              }
            );
          }
        }

        // The model routinely returns nine when asked for ten, so a chunked
        // run lands short however firmly the prompt insists - and discarding a
        // chunk's repeats widens the same gap. Ask again for just the
        // shortfall rather than accepting it: a request for fifty products
        // should produce fifty.
        const topUpAttempts = topUpBudget(chunks.length);

        for (
          let attempt = 1;
          allProducts.length < count && attempt <= topUpAttempts;
          attempt++
        ) {
          const shortfall = count - allProducts.length;
          // Never ask for more than one chunk: a larger request re-enters this
          // same chunking branch, which tops up again, and the rounds multiply.
          const ask = Math.min(shortfall, effectiveChunkSize);

          logger?.info?.(
            `[AIService] Topping up ${ask} of ${shortfall} missing product${shortfall === 1 ? '' : 's'} (attempt ${attempt}/${topUpAttempts})`,
            { requested: count, have: allProducts.length, correlationId }
          );

          const topUpCategory = categoriesList[attempt % categoriesList.length];
          const topUpResult = await this.generateProductData(
            topUpCategory,
            ask,
            requestConfig,
            model,
            selectedLanguages,
            {
              ...options,
              avoidProducts: ledger.avoid(),
              categories: [topUpCategory],
            }
          );

          const topUpItems = Array.isArray(topUpResult)
            ? topUpResult
            : topUpResult?.products || [];

          // A repeat of something already generated is no progress at all: the
          // shortfall stands and the catalogue gains a second product with the
          // same name. `createProductLedger` holds that rule for both loops.
          let added = 0;

          for (const product of topUpItems) {
            if (allProducts.length >= count) break;

            if (!ledger.add(product)) continue;

            allProducts.push(product);
            added++;
          }

          logger?.debug?.(
            `[AIService] Top-up attempt ${attempt} added ${added} of ${topUpItems.length} returned`,
            { correlationId }
          );

          if (added === 0) break;
        }

        if (allProducts.length !== count) {
          logger?.warn?.(
            `[AIService] Product generation delivered ${allProducts.length} of ${count} requested products`,
            {
              requested: count,
              delivered: allProducts.length,
              shortfall: count - allProducts.length,
              correlationId,
            }
          );
        }

        return allProducts.slice(0, count);
      }

      const vars = {
        avoidProductsGuidance: avoidProductsGuidance(options.avoidProducts),
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
            ? `- priceEntries: array of price list entry objects, one per object in "skuVariants" — see the Price Coverage rule below. Each object must have:
            - price (number): The unit price.
            - skuExternalReferenceCode (string): This MUST be the same as the SKU's "sku" code (e.g., "PRODUCT-001-BLK-L"), and every variant's code MUST appear on exactly one entry.
            - priceListExternalReferenceCode (string): Always use "AICA-PL-GENERAL".
            - externalReferenceCode (string): Unique identifier for this entry.
            - discountDiscovery (boolean): Always set to false.
            - promoPrice (number or null): The promotional price for this entry. Generate this for approximately 20% of products, otherwise null.
            ${
              options.generateBulkPricing || options.generateTierPricing
                ? `
            - bulkPricing (boolean): ${options.generateBulkPricing ? 'Set to true for Bulk Pricing (same price for all items if threshold reached).' : 'Set to false for Tiered Pricing (different prices for quantity ranges).'}
            - tierPrices (array): List of objects with "minimumQuantity" (number), "price" (number), and "externalReferenceCode" (string). Generate at least two tiers (e.g., 5+ and 10+). Every entry gets its own tiers, with external reference codes unique to that entry — see the Price Tiers rule below.`
                : ''
            }`
            : '',
        groundingMetadata: options.groundingMetadata || null,

        // Composed rather than branched in the template: promptService has no
        // conditional or loop, so the `{% if %}` and `{% for %}` these replace
        // were inert and leaked into the prompt. See #643.
        brandGuidance: brandGuidance(options.brandName),
        currencyGuidance: currencyGuidance(options.groundingMetadata),
        languageGuidance: languageGuidance(options.groundingMetadata),
        vocabularyGuidance: vocabularyGuidance(options.groundingMetadata),
      };

      const promptContent = await prompt.render('product', vars, requestConfig);
      return await this._chatJson(
        'product',
        promptContent,
        requestConfig,
        model,
        'product',
        langs
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
        const businessCount = shareCount(count, ratio);
        const personCount = count - businessCount;

        logger?.info?.(
          `[AIService] Splitting mixed accounts by ratio ${ratio}%: ${businessCount} business, ${personCount} person`,
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
        languageGuidance: languageGuidance(options.groundingMetadata),
        brandGuidance: brandGuidance(
          options.brandName,
          'These accounts are potential customers or business partners for ' +
            'this brand.'
        ),
        accountTypeGuidance: accountTypeGuidance({
          accountType: options.accountType,
          categories: categories.join(', '),
          count,
          pluralSuffix: pluralize(count),
        }),
        ...accountGeography(options.geographicContext),
        accountType,
      };

      const promptContent = await prompt.render('account', vars, requestConfig);
      return await this._chatJson(
        'account',
        promptContent,
        requestConfig,
        model,
        'account',
        langs
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
        languageGuidance: languageGuidance(options.groundingMetadata),
        brandGuidance: brandGuidance(
          options.brandName,
          'These orders represent business transactions with this brand.'
        ),
        orderDateGuidance: orderDateGuidance(options.orderDateRangeDays),
      };

      const promptContent = await prompt.render('order', vars, requestConfig);
      return await this._chatJson(
        'order',
        promptContent,
        requestConfig,
        model,
        'order',
        langs
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
        languageGuidance: languageGuidance(options.groundingMetadata),
        ...warehouseGeography(options.geographicContext),
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
        'warehouse',
        langs
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
    const { logger, prompt } = this.ctx;
    const correlationId = options?.correlationId;

    try {
      const provider = await this.getAIProvider(options, 'media');
      const runtime = await this.getRuntimeAIConfig(options);

      // Rendered here rather than assembled inside the provider, for the same
      // reason every other generator renders here: the prompt is a
      // configuration item an operator can edit, and one built by string
      // concatenation in a provider is the only prompt they cannot see. It is
      // also the only place `brandName` is available, which images need as
      // much as the PDF and product prompts do.
      //
      // `noBrand` is passed rather than inferred in the template so the
      // template stays declarative. The two branches are deliberately
      // exclusive: with a brand configured the images should carry that brand,
      // and only without one should they be brand-free. A blanket "no brand
      // names" instruction would strip the operator's own brand from their
      // own catalogue.
      // Composed here rather than branched in the template. promptService
      // supports only {{var}} and {{=json:var}} - there is no conditional - so
      // a `{% if %}` in a prompt file is inert and leaks its markers into the
      // text along with both branches. See #643.
      //
      // The two cases are exclusive on purpose. With brand context supplied the
      // images should carry that brand; only without it should they be
      // brand-free. A blanket "no brand names" would strip an operator's own
      // brand from their own catalogue - and the field is free text, labelled
      // "Brand / Context" in the UI, so it may be a description rather than a
      // name and must not be quoted as one.
      const brandContext = String(options.brandName || '').trim();
      const brandGuidance = brandContext
        ? `BRAND CONTEXT: ${brandContext}\n\nLet that shape the product's ` +
          'appearance, materials and finish. Any branding visible on the ' +
          'product must be consistent with the description above, and must ' +
          "not show any other company's logo, name or marks."
        : 'The product must be generic and unbranded: no logos, no brand ' +
          'names, no visible text, lettering or numbering on the product or ' +
          'the background.';

      const category = String(options.category || '').trim();

      const promptContent = await prompt.render(
        'image',
        {
          brandGuidance,
          categoryGuidance: category
            ? `The product is in the ${category} category and should look plausible for it.`
            : '',
          imageStyle: options.imageStyle || 'photographic',
          productName: product.name?.en_US || product.name,
        },
        options
      );

      return await provider.generateImage(product, {
        ...runtime,
        credentials: runtime.mediaCredentials, // USE MEDIA CREDENTIALS
        ...options,
        prompt: promptContent,
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
      }));

      const vars = {
        brandName: options.brandName || '',
        pricingType,
        productListJSON: JSON.stringify(productList, null, 2),
        ...pricingHints(pricingType),
        groundingMetadata: options.groundingMetadata || null,
        brandGuidance: brandGuidance(
          options.brandName,
          'This price list is for products belonging to this brand.'
        ),
        currencyGuidance: currencyGuidance(options.groundingMetadata),
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

  /**
   * The parameter order matches every other generator here so GenerationFacade
   * can dispatch to it. It used to take `options` third and a bare
   * `{ correlationId }` fourth, which meant the run's provider, model and key
   * never reached `_chatJson` - it resolved them from persisted configuration
   * instead, silently ignoring whatever the run asked for. See #697.
   */
  async generatePromoData(
    products = [],
    accounts = [],
    requestConfig = {},
    model = null,
    _selectedLanguages = ['en-US'],
    options = {}
  ) {
    const { logger, prompt } = this.ctx;
    const correlationId = requestConfig?.correlationId || 'system';

    try {
      const productList = products.map((p) => ({
        name: p.name?.en_US || p.name,
        sku: p.sku || p.externalReferenceCode,
      }));

      const accountList = accounts.map((a) => ({
        name: a.name,
        externalReferenceCode: a.externalReferenceCode,
        id: a.id,
      }));

      const vars = {
        brandName: options.brandName || '',
        productListJSON: JSON.stringify(productList, null, 2),
        accountListJSON: JSON.stringify(accountList, null, 2),
        // The promo prompt received no brand context at all - the options were
        // passed in and discarded - so segment and promotion names had nothing
        // to anchor to.
        brandGuidance: brandGuidance(
          options.brandName,
          'Ensure segment descriptions, promotion names and targeting logic ' +
            'reflect this brand.'
        ),
      };

      const promptContent = await prompt.render('promo', vars, requestConfig);
      return await this._chatJson(
        'promo',
        promptContent,
        requestConfig,
        model,
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

module.exports = { AIService, topUpBudget };
