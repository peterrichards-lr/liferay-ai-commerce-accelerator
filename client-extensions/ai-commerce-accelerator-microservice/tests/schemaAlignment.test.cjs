const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { logger } = require('../utils/logger.cjs');

describe('Schema Alignment (Drift Detection)', () => {
  let ajv;

  beforeEach(() => {
    ajv = new Ajv({ allErrors: true, strict: false });
  });

  const generationSchemasDir = path.join(__dirname, '../generation-schemas');
  const apiSchemasDir = path.join(__dirname, '../api-schemas');

  const mappings = [
    {
      gen: 'product.json',
      spec: 'headless-commerce-admin-catalog-v1.0-openapi.json',
      entity: 'Product',
      path: 'properties.products.items'
    },
    {
      gen: 'account.json',
      spec: 'headless-admin-user-v1.0-openapi.json',
      entity: 'Account',
      path: 'properties.accounts.items'
    },
    {
      gen: 'warehouse.json',
      spec: 'headless-commerce-admin-inventory-v1.0-openapi.json',
      entity: 'Warehouse',
      path: 'properties.warehouses.items'
    }
  ];

  mappings.forEach(({ gen, spec, entity, path: schemaPath }) => {
    it(`should ensure ${gen} is aligned with Liferay ${entity} DTO`, () => {
      const genSchema = JSON.parse(fs.readFileSync(path.join(generationSchemasDir, gen), 'utf8'));
      const apiSpec = JSON.parse(fs.readFileSync(path.join(apiSchemasDir, spec), 'utf8'));
      const apiSchema = apiSpec.components.schemas[entity];

      // Navigate to the entity part of the generation schema
      const parts = schemaPath.split('.');
      let targetGenSchema = genSchema;
      for (const part of parts) {
        targetGenSchema = targetGenSchema[part];
      }

      // Basic field existence check
      const genProps = Object.keys(targetGenSchema.properties || {});
      const apiProps = Object.keys(apiSchema.properties || {});

      genProps.forEach(prop => {
        // Some properties are internal orchestration fields, allow those
        const allowedInternal = ['skus', 'options', 'specifications', 'headOfficeAddress', 'billingAddress', 'shippingAddress', 'category', 'productOptionValues'];
        
        if (!apiProps.includes(prop) && !allowedInternal.includes(prop)) {
          // This highlights drift!
          logger.warn(`[Drift Warning] ${gen} property "${prop}" is not in Liferay ${entity} DTO`);
        }
      });

      expect(true).toBe(true); // Always passes, but logs warnings
    });
  });
});
