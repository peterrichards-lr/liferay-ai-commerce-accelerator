const MockDataGenerator = require('../generators/mockDataGenerator.cjs');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const loadSchema = (name) => {
  const schemaPath = path.resolve(
    __dirname,
    `../generation-schemas/${name}.json`
  );
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
};

describe('Data Generation Reliability', () => {
  let mockGenerator;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    };
    mockGenerator = new MockDataGenerator(mockCtx);
  });

  describe('Product Generation', () => {
    const productSchema = loadSchema('product');
    const validate = ajv.compile(productSchema);

    it('should generate valid simple products', async () => {
      const config = { catalogId: 123 };
      const options = { productCount: 5, selectedLanguages: ['en-US'] };

      const products = await mockGenerator.generateProductData(
        'Electronics',
        5,
        config,
        null,
        ['en-US'],
        options
      );

      expect(products).toHaveLength(5);

      const isValid = validate({ products });
      if (!isValid) {
        console.error('Schema errors:', validate.errors);
      }
      expect(isValid).toBe(true);

      // Verify specific Liferay requirements
      products.forEach((p) => {
        expect(p.productType).toBe('simple');
        expect(p.externalReferenceCode).toMatch(/^AICA-PRD-/);
        expect(p.skus).toHaveLength(1);
        expect(p.skus[0].externalReferenceCode).toBe(p.baseSku);
      });
    });

    it('should generate valid products with variants', async () => {
      const config = { catalogId: 123 };
      const options = {
        productCount: 2,
        generateSkuVariants: true,
        selectedLanguages: ['en-US', 'es-ES'],
      };

      const products = await mockGenerator.generateProductData(
        'Clothing',
        2,
        config,
        null,
        ['en-US', 'es-ES'],
        options
      );

      const isValid = validate({ products });
      if (!isValid) {
        console.error(
          'Schema errors (variants):',
          JSON.stringify(validate.errors, null, 2)
        );
      }
      expect(isValid).toBe(true);

      products.forEach((p) => {
        expect(p.skuVariants).toBeDefined();
        expect(p.skuVariants.length).toBeGreaterThan(0);
        expect(p.name.en_US).toBeDefined();
        expect(p.name.es_ES).toBeDefined();
      });
    });
  });

  describe('Account Generation', () => {
    const accountSchema = loadSchema('account');
    const validate = ajv.compile(accountSchema);

    it('should generate valid accounts', async () => {
      const accounts = await mockGenerator.generateAccountData(
        3,
        {},
        null,
        [],
        ['en-US']
      );

      expect(accounts).toHaveLength(3);
      const isValid = validate({ accounts });
      expect(isValid).toBe(true);

      accounts.forEach((a) => {
        expect(a.externalReferenceCode).toMatch(/^AICA-ACC-/);
        expect(a.headOfficeAddress).toBeDefined();
        expect(a.type).toBe('business');
      });
    });

    it('should generate only "person" accounts when accountType is "person"', async () => {
      const accounts = await mockGenerator.generateAccountData(
        4,
        {},
        null,
        [],
        ['en-US'],
        { accountType: 'person' }
      );

      expect(accounts).toHaveLength(4);
      const isValid = validate({ accounts });
      expect(isValid).toBe(true);
      accounts.forEach((a) => expect(a.type).toBe('person'));
    });

    it('should generate a mix of "business" and "person" accounts when accountType is "mixed"', async () => {
      const accounts = await mockGenerator.generateAccountData(
        4,
        {},
        null,
        [],
        ['en-US'],
        { accountType: 'mixed' }
      );

      expect(accounts).toHaveLength(4);
      const isValid = validate({ accounts });
      expect(isValid).toBe(true);
      const types = new Set(accounts.map((a) => a.type));
      expect(types.has('business')).toBe(true);
      expect(types.has('person')).toBe(true);
    });
  });

  describe('Warehouse Generation', () => {
    const warehouseSchema = loadSchema('warehouse');
    const validate = ajv.compile(warehouseSchema);

    it('should generate valid warehouses', async () => {
      const warehouses = await mockGenerator.generateWarehouseData(
        2,
        {},
        null,
        ['en-US']
      );

      expect(warehouses).toHaveLength(2);
      const isValid = validate({ warehouses });
      expect(isValid).toBe(true);

      warehouses.forEach((w) => {
        expect(w.externalReferenceCode).toMatch(/^AICA-WH-/);
        expect(w.active).toBe(true);
      });
    });
  });

  describe('Order Generation', () => {
    const orderSchema = loadSchema('order');
    const validate = ajv.compile(orderSchema);

    it('should generate valid orders with a default ~30 day date spread', async () => {
      const orders = await mockGenerator.generateOrderData([], [], 5);

      expect(orders).toHaveLength(5);
      const isValid = validate({ orders });
      expect(isValid).toBe(true);

      const now = Date.now();
      orders.forEach((o) => {
        expect(o.orderDate).toBeDefined();
        const orderTime = new Date(o.orderDate).getTime();
        expect(orderTime).toBeLessThanOrEqual(now);
        expect(orderTime).toBeGreaterThanOrEqual(
          now - 31 * 24 * 60 * 60 * 1000
        );
      });
    });

    it('should respect a configurable orderDateRangeDays', async () => {
      const orders = await mockGenerator.generateOrderData(
        [],
        [],
        5,
        {},
        null,
        ['en-US'],
        { orderDateRangeDays: 365 }
      );

      expect(orders).toHaveLength(5);
      const isValid = validate({ orders });
      expect(isValid).toBe(true);

      const now = Date.now();
      orders.forEach((o) => {
        const orderTime = new Date(o.orderDate).getTime();
        expect(orderTime).toBeGreaterThanOrEqual(
          now - 366 * 24 * 60 * 60 * 1000
        );
      });
    });
  });
});
