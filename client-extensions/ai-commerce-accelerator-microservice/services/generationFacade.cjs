const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class GenerationFacade {
  constructor(ctx) {
    this.ctx = ctx;
    this.logger = ctx.logger;
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      removeAdditional: true,
      useDefaults: true,
    });
    addFormats(this.ajv);
    this.validators = {};
    this._loadSchemas();
  }

  _loadSchemas() {
    const schemaDir = path.join(__dirname, '../generation-schemas');
    try {
      const files = fs.readdirSync(schemaDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const schemaName = path.basename(file, '.json');
          const schemaContent = JSON.parse(
            fs.readFileSync(path.join(schemaDir, file), 'utf8')
          );
          this.validators[schemaName] = this.ajv.compile(schemaContent);
          this.logger.debug(`Loaded generation schema: ${schemaName}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to load generation schemas: ${error.message}`);
    }
  }

  /**
   * Primary entry point for routing and validating all generated data.
   */
  async generateData(entityType, count, requestConfig, options = {}) {
    const { demoMode, correlationId, openAiKey } = options;
    const generator = demoMode ? this.ctx.mockDataGenerator : this.ctx.ai;

    // HARDENING: Propagate openAiKey from options to requestConfig if present
    if (openAiKey) {
      requestConfig.openAiKey = openAiKey;
    }

    const methodMap = {
      product: 'generateProductData',
      account: 'generateAccountData',
      order: 'generateOrderData',
      warehouse: 'generateWarehouseData',
      pricing: 'generatePricingData',
    };

    const methodName = methodMap[entityType];
    if (!methodName || typeof generator[methodName] !== 'function') {
      throw new Error(`Unsupported generation entity type: ${entityType}`);
    }

    this.logger.info(
      `Routing ${entityType} generation request to ${demoMode ? 'Mock' : 'AI'} service`,
      {
        count,
        correlationId,
      }
    );

    let data;
    const selectedLanguages = options.selectedLanguages || ['en-US'];

    if (entityType === 'product') {
      data = await generator.generateProductData(
        options.category || 'Electronics',
        count,
        requestConfig,
        requestConfig.aiModel,
        selectedLanguages,
        options
      );
    } else if (entityType === 'account') {
      data = await generator.generateAccountData(
        count,
        requestConfig,
        requestConfig.aiModel,
        options.categories || [],
        selectedLanguages,
        options
      );
    } else if (entityType === 'order') {
      data = await generator.generateOrderData(
        options.products || [],
        options.accounts || [],
        count,
        requestConfig,
        requestConfig.aiModel,
        selectedLanguages,
        options
      );
    } else if (entityType === 'warehouse') {
      data = await generator.generateWarehouseData(
        count,
        requestConfig,
        requestConfig.aiModel,
        selectedLanguages,
        options
      );
    } else if (entityType === 'pricing') {
      data = await generator.generatePricingData(
        options.products || [],
        options.pricingType || 'standard',
        requestConfig,
        requestConfig.aiModel,
        selectedLanguages,
        options
      );
    }

    // 1. Standardize/Normalize first (inject missing ERCs, etc)
    const standardizedData = this._standardize(data);

    // 2. Validate against schema
    return this.validateAndNormalize(entityType, standardizedData, {
      ...options,
      count,
    });
  }

  validateAndNormalize(schemaName, data, options = {}) {
    const validator = this.validators[schemaName];
    const correlationId = options.correlationId;
    const count = options.count || 0;

    if (validator) {
      // Wrap in expected object structure if schema expects it (e.g. { products: [...] })
      const mainPropertyName = schemaName + 's';
      let payload;

      if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        data[mainPropertyName]
      ) {
        // Already wrapped correctly
        payload = data;
      } else {
        // Wrap it ourselves
        const dataArr = Array.isArray(data) ? data : [data];
        payload = { [mainPropertyName]: dataArr };
      }

      const isValid = validator(payload);
      if (!isValid) {
        this.logger.error(`${schemaName} generation failed schema validation`, {
          errors: validator.errors,
          correlationId,
        });

        const err = new Error(
          `${schemaName} generation failed schema validation`
        );
        err.name = 'ValidationError';
        err.errors = validator.errors;
        err.errorReference = createERC(ERC_PREFIX.ERROR);
        throw err;
      }

      // Extract array back if it was wrapped
      if (
        payload[mainPropertyName] &&
        Array.isArray(payload[mainPropertyName])
      ) {
        data = payload[mainPropertyName];
      }

      // HARDENING: Truncate to requested count if exceeded to maintain UI consistency
      if (count > 0 && Array.isArray(data) && data.length > count) {
        this.logger.warn(
          `${schemaName} generator returned ${data.length} items, truncating to requested ${count}`,
          { correlationId }
        );
        data = data.slice(0, count);
      }
    }

    return data;
  }

  /**
   * Ensures the data structure is standardized for BaseGenerator._normalize.
   */
  _standardize(data) {
    if (!Array.isArray(data)) {
      return this._standardizeItem(data);
    }
    return data.map((item) => this._standardizeItem(item));
  }

  _standardizeItem(item) {
    if (!item || typeof item !== 'object') return item;

    // Ensure ERC exists
    if (!item.externalReferenceCode && !item.erc) {
      // Try to determine a prefix based on common properties or fallback to BATCH
      item.externalReferenceCode = createERC(ERC_PREFIX.BATCH);
    }

    return item;
  }
}

module.exports = { GenerationFacade };
