const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

class ContractValidator {
  constructor(ctx) {
    this.ctx = ctx;
    this.logger = ctx.logger;
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      logger: {
        log: (...args) => ctx.logger.debug(...args),
        warn: (...args) => ctx.logger.warn(...args),
        error: (...args) => ctx.logger.error(...args),
      },
    });
    addFormats(this.ajv);
    this.schemas = {};
    this.validators = {};
    this._loadSchemas();
  }

  _loadSchemas() {
    const apiSchemaDir = path.join(__dirname, '../../api-schemas');
    try {
      const files = fs.readdirSync(apiSchemaDir);
      for (const file of files) {
        if (file.endsWith('-openapi.json')) {
          const spec = JSON.parse(
            fs.readFileSync(path.join(apiSchemaDir, file), 'utf8')
          );
          const fileName = path.basename(file);

          // Pre-process the whole spec for OpenAPI specifics
          this._handleOpenApiSpecifics(spec);

          // Add the whole spec to AJV with the filename as the base ID
          spec.$id = fileName;
          this.ajv.addSchema(spec);

          this.schemas[fileName] = spec;
        }
      }
    } catch (error) {
      this.logger.error(`Failed to load API schemas: ${error.message}`);
    }
  }

  _handleOpenApiSpecifics(schema) {
    if (!schema || typeof schema !== 'object') return;

    // Handle OpenAPI 'exclusiveMinimum/Maximum'
    if (typeof schema.exclusiveMinimum === 'boolean') {
      if (
        schema.exclusiveMinimum === true &&
        typeof schema.minimum === 'number'
      ) {
        schema.exclusiveMinimum = schema.minimum;
        delete schema.minimum;
      } else {
        delete schema.exclusiveMinimum;
      }
    }
    if (typeof schema.exclusiveMaximum === 'boolean') {
      if (
        schema.exclusiveMaximum === true &&
        typeof schema.maximum === 'number'
      ) {
        schema.exclusiveMaximum = schema.maximum;
        delete schema.maximum;
      } else {
        delete schema.exclusiveMaximum;
      }
    }

    // Convert OpenAPI 'nullable: true' to JSON Schema 'type: [..., "null"]'
    if (schema.nullable === true && schema.type) {
      if (Array.isArray(schema.type)) {
        if (!schema.type.includes('null')) {
          schema.type.push('null');
        }
      } else {
        schema.type = [schema.type, 'null'];
      }
      delete schema.nullable;
    }

    // Recurse into everything
    for (const key in schema) {
      if (typeof schema[key] === 'object') {
        this._handleOpenApiSpecifics(schema[key]);
      }
    }
  }

  /**
   * Validates data against a specific Liferay API schema.
   * @param {string} specFileName e.g. 'headless-commerce-admin-catalog-v1.0-openapi.json'
   * @param {string} schemaName e.g. 'Product'
   * @param {any} data The data to validate
   * @returns {boolean}
   */
  validate(specFileName, schemaName, data) {
    const fullSchemaId = `${specFileName}#/components/schemas/${schemaName}`;
    let validator = this.validators[fullSchemaId];

    if (!validator) {
      validator = this.ajv.getSchema(fullSchemaId);
      if (!validator) {
        throw new Error(`Schema not found: ${fullSchemaId}`);
      }
      this.validators[fullSchemaId] = validator;
    }

    const isValid = validator(data);
    if (!isValid) {
      // Create a descriptive error message
      const errorsText = this.ajv.errorsText(validator.errors);
      this.logger.error(
        `Contract violation for ${fullSchemaId}: ${errorsText}`,
        {
          errors: validator.errors,
          data: this.ctx.DEBUG ? data : '[truncated]',
        }
      );

      const error = new Error(
        `Data does not match Liferay API contract for ${schemaName}: ${errorsText}`
      );
      error.name = 'ContractViolationError';
      error.errors = validator.errors;
      error.schemaId = fullSchemaId;
      throw error;
    }

    return true;
  }

  /**
   * Validates an array of items against a specific Liferay API schema.
   */
  validateArray(specFileName, schemaName, dataArray) {
    if (!Array.isArray(dataArray)) {
      throw new Error('Data must be an array for validateArray');
    }
    // We validate each item individually to provide better error messages
    for (let i = 0; i < dataArray.length; i++) {
      try {
        this.validate(specFileName, schemaName, dataArray[i]);
      } catch (err) {
        if (err.name === 'ContractViolationError') {
          err.message = `Item at index ${i} failed contract: ${err.message}`;
        }
        throw err;
      }
    }
    return true;
  }
}

module.exports = ContractValidator;
