const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

const POINTER_UNESCAPE = [
  [/~1/g, '/'],
  [/~0/g, '~'],
];

function pointerTokens(pointer) {
  if (!pointer || pointer === '/') return [];
  return pointer
    .split('/')
    .slice(1)
    .map((token) =>
      POINTER_UNESCAPE.reduce(
        (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
        token
      )
    );
}

function resolvePointerParent(root, pointer) {
  const tokens = pointerTokens(pointer);
  if (tokens.length === 0) return null;

  let node = root;
  for (const token of tokens.slice(0, -1)) {
    if (node == null || typeof node !== 'object') return null;
    node = Array.isArray(node) ? node[Number(token)] : node[token];
  }
  if (node == null || typeof node !== 'object') return null;

  return { parent: node, key: tokens[tokens.length - 1] };
}

function valueAtPointer(root, pointer) {
  const resolved = resolvePointerParent(root, pointer);
  if (!resolved) return undefined;
  const { parent, key } = resolved;
  return Array.isArray(parent) ? parent[Number(key)] : parent[key];
}

/**
 * Removes properties that are null where the schema does not allow null,
 * identified from ajv's own type errors. Returns the pointers dropped.
 */
function dropNullTypeViolations(payload, errors) {
  const dropped = [];

  for (const error of errors || []) {
    if (error.keyword !== 'type') continue;
    if (valueAtPointer(payload, error.instancePath) !== null) continue;

    const resolved = resolvePointerParent(payload, error.instancePath);
    if (!resolved) continue;

    const { parent, key } = resolved;
    if (Array.isArray(parent)) continue;

    delete parent[key];
    dropped.push(error.instancePath);
  }

  return dropped;
}

const OFFENDING_VALUE_MAX_LENGTH = 200;

function describeOffendingValues(payload, errors) {
  const seen = new Map();

  for (const error of (errors || []).slice(0, 20)) {
    if (seen.has(error.instancePath)) continue;

    let rendered;
    try {
      rendered = JSON.stringify(valueAtPointer(payload, error.instancePath));
    } catch {
      rendered = '<unserializable>';
    }
    if (rendered === undefined) rendered = '<absent>';
    if (rendered.length > OFFENDING_VALUE_MAX_LENGTH) {
      rendered = `${rendered.slice(0, OFFENDING_VALUE_MAX_LENGTH)}...`;
    }

    seen.set(error.instancePath, rendered);
  }

  return Object.fromEntries(seen);
}

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
    const standardizedData = this._standardize(data, entityType);

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
        let dataArr = Array.isArray(data) ? data : [data];

        // HARDENING: If it's a nested array (e.g. [[{...}]]), flatten it one level.
        // Also filter out any non-object items that might have hallucinated.
        if (
          dataArr.length === 1 &&
          Array.isArray(dataArr[0]) &&
          dataArr[0].length > 0
        ) {
          dataArr = dataArr[0];
        }

        // Final sanity check: ensure everything in the array is an object
        dataArr = dataArr.filter(
          (item) => item != null && typeof item === 'object'
        );

        payload = { [mainPropertyName]: dataArr };
      }

      let isValid = validator(payload);

      // Models routinely emit `null` for optional fields instead of omitting
      // them, which fails as "must be string"/"must be object" even though the
      // field was never required. Drop those and revalidate once. Driven by
      // ajv's own errors rather than by walking the schema, so a value the
      // schema genuinely permits to be null - promoPrice is the only one - is
      // never touched, because ajv does not flag it.
      if (!isValid) {
        const dropped = dropNullTypeViolations(payload, validator.errors);
        if (dropped.length > 0) {
          isValid = validator(payload);
          this.logger.debug?.(
            `${schemaName} payload had null optional fields; dropped and revalidated`,
            { dropped, revalidated: isValid, correlationId }
          );
        }
      }

      if (!isValid) {
        this.logger.error(`${schemaName} generation failed schema validation`, {
          errors: validator.errors,
          // Without the offending values a failure says which path was wrong
          // but not what arrived, which turns a glance into an investigation.
          offendingValues: describeOffendingValues(payload, validator.errors),
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

      if (count > 0 && Array.isArray(data) && data.length === 0) {
        const emptyErr = new Error(
          `AI generation produced 0 valid ${schemaName} items for requested count of ${count}.`
        );
        emptyErr.name = 'ValidationError';
        emptyErr.errorReference = createERC(ERC_PREFIX.ERROR);
        throw emptyErr;
      }
    }

    return data;
  }

  /**
   * Ensures the data structure is standardized for BaseGenerator._normalize.
   */
  _standardize(data, entityType) {
    if (!data) return data;

    // If we have an entityType, check if it's a wrapped object containing the array,
    // e.g. { warehouses: [...] } for entityType === 'warehouse'.
    if (entityType) {
      const mainPropertyName = entityType + 's';
      if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        data[mainPropertyName] &&
        Array.isArray(data[mainPropertyName])
      ) {
        data[mainPropertyName] = data[mainPropertyName].map((item) =>
          this._standardizeItem(item, entityType)
        );
        return data;
      }
    }

    if (!Array.isArray(data)) {
      return this._standardizeItem(data, entityType);
    }
    return data.map((item) => this._standardizeItem(item, entityType));
  }

  _standardizeItem(item, entityType) {
    if (!item || typeof item !== 'object') return item;

    // Ensure ERC exists and is consistent
    if (item.erc && !item.externalReferenceCode) {
      item.externalReferenceCode = item.erc;
    }

    if (!item.externalReferenceCode && !item.erc) {
      // Try to determine a prefix based on common properties or fallback to BATCH
      item.externalReferenceCode = createERC(ERC_PREFIX.BATCH);
    }

    if (entityType === 'product') {
      if (!item.productType) {
        item.productType = 'simple';
      }
      if (!item.baseSku) {
        item.baseSku = item.skus?.[0]?.sku || item.externalReferenceCode;
      }
      if (!Array.isArray(item.skus) || item.skus.length === 0) {
        item.skus = [
          {
            sku: item.baseSku,
            externalReferenceCode: item.baseSku,
            price: typeof item.price === 'number' ? item.price : 100,
            cost: typeof item.cost === 'number' ? item.cost : 50,
            inventoryLevel:
              typeof item.inventoryLevel === 'number'
                ? item.inventoryLevel
                : 100,
            published: true,
            purchasable: true,
            neverExpire: true,
          },
        ];
      }
      if (!item.shortDescription) {
        if (item.description && typeof item.description === 'object') {
          item.shortDescription = {};
          for (const [lang, desc] of Object.entries(item.description)) {
            item.shortDescription[lang] = String(desc).substring(0, 200);
          }
        } else {
          item.shortDescription =
            item.name && typeof item.name === 'object'
              ? { ...item.name }
              : { en_US: String(item.name || 'Product summary') };
        }
      }
      if (!item.urls) {
        item.urls = {};
        if (item.name && typeof item.name === 'object') {
          for (const [lang, name] of Object.entries(item.name)) {
            item.urls[lang] = String(name)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
          }
        } else {
          item.urls = { en_US: 'product' };
        }
      }
    }

    return item;
  }
}

module.exports = {
  GenerationFacade,
  dropNullTypeViolations,
  describeOffendingValues,
};
