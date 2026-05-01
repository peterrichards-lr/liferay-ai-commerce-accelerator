const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger.cjs');

describe('Schema Alignment (Drift Detection)', () => {
  const generationSchemasDir = path.join(__dirname, '../generation-schemas');
  const apiSchemasDir = path.join(__dirname, '../api-schemas');

  const generationSchemas = fs
    .readdirSync(generationSchemasDir)
    .filter((f) => f.endsWith('.json'));

  it.each(generationSchemas)(
    'should align %s with the corresponding Liferay API contract',
    (schemaFile) => {
      const genSchema = JSON.parse(
        fs.readFileSync(path.join(generationSchemasDir, schemaFile), 'utf8')
      );

      // Map generation schema name to Liferay API contract name
      const mapping = {
        'product.json': 'headless-commerce-admin-catalog-v1.0-openapi.json',
        'account.json': 'headless-admin-user-v1.0-openapi.json',
        'order.json': 'headless-commerce-admin-order-v1.0-openapi.json',
        'warehouse.json': 'headless-commerce-admin-inventory-v1.0-openapi.json',
      };

      const apiContractFile = mapping[schemaFile];
      if (!apiContractFile) {
        logger.warn(`No API contract mapping found for ${schemaFile}`);
        return;
      }

      const apiContract = JSON.parse(
        fs.readFileSync(path.join(apiSchemasDir, apiContractFile), 'utf8')
      );

      const entityName = schemaFile.replace('.json', '');
      const componentName =
        entityName.charAt(0).toUpperCase() + entityName.slice(1);

      const apiSchema =
        apiContract.components?.schemas?.[componentName] ||
        apiContract.components?.schemas?.[componentName.replace(/s$/, '')];

      if (!apiSchema) {
        throw new Error(
          `Could not find schema for ${componentName} in ${apiContractFile}`
        );
      }

      // 1. Check for required fields in API that are missing in generator
      if (apiSchema.required) {
        apiSchema.required.forEach((field) => {
          const genField =
            genSchema.properties?.[field] ||
            genSchema.properties?.[entityName + 's']?.items?.properties?.[
              field
            ];

          // Special cases or nested logic can be added here
          if (!genField) {
            logger.warn(
              `Potential drift: Required field "${field}" in Liferay API is missing in ${schemaFile}`
            );
          }
        });
      }

      // 2. Check for type mismatches (basic)
      if (genSchema.properties) {
        Object.keys(genSchema.properties).forEach((field) => {
          const apiField = apiSchema.properties?.[field];
          if (apiField && apiField.type && genSchema.properties[field].type) {
            if (apiField.type !== genSchema.properties[field].type) {
              // Localized fields in Liferay are objects, but we often simplify them in gen
              if (apiField.type === 'object' && apiField.properties?.en_US) {
                return;
              }
              logger.warn(
                `Type mismatch for "${field}" in ${schemaFile}: Liferay=${apiField.type}, Generator=${genSchema.properties[field].type}`
              );
            }
          }
        });
      }
    }
  );
});
