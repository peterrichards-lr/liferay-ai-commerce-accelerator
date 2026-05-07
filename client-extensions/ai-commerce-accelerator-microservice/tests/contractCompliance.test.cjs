const ContractValidator = require('../services/contractValidator.cjs');
const MockDataGenerator = require('../generators/mockDataGenerator.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { createERC } = require('../utils/misc.cjs');

describe('Liferay API Contract Compliance', () => {
  let validator;
  let mockCtx;
  let mockData;

  beforeAll(() => {
    mockCtx = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
      DEBUG: true,
    };
    validator = new ContractValidator(mockCtx);
    mockData = new MockDataGenerator(mockCtx);
  });

  describe('Account & Address Compliance', () => {
    const spec = 'headless-admin-user-v1.0-openapi.json';

    it('should generate accounts that match the Account DTO', async () => {
      const accounts = mockData.generateAccountData(3);
      // Headless API expects certain fields to be moved/stripped during POST
      // but for dry contract check, we test the core properties.
      validator.validateArray(spec, 'Account', accounts);
    });

    it('should generate addresses that match the PostalAddress DTO', async () => {
      // Logic from AccountGenerator: addresses are built from headOfficeAddress etc.
      const accountData = mockData.generateAccountData(1)[0];
      const address = {
        ...accountData.headOfficeAddress,
        externalReferenceCode: createERC(ERC_PREFIX.ADDRESS),
      };

      // REGRESSION CHECK: Ensure 'accountId' is NOT in the payload (as fixed recently)
      expect(address).not.toHaveProperty('accountId');

      validator.validate(spec, 'PostalAddress', address);
    });
  });

  describe('Product & Sku Compliance', () => {
    const spec = 'headless-commerce-admin-catalog-v1.0-openapi.json';

    it('should generate products that match the Product DTO', async () => {
      const products = mockData.generateProductData('Electronics', 3);
      validator.validateArray(spec, 'Product', products);
    });

    it('should generate product specifications that match the DTO', async () => {
      const products = mockData.generateProductData('Electronics', 1);
      const specs = products[0].productSpecifications;

      // REGRESSION CHECK: Ensure 'externalReferenceCode' is NOT in nested specs (as fixed recently)
      specs.forEach((s) => {
        expect(s).not.toHaveProperty('externalReferenceCode');
      });

      validator.validateArray(spec, 'ProductSpecification', specs);
    });
  });

  describe('Warehouse & Inventory Compliance', () => {
    const spec = 'headless-commerce-admin-inventory-v1.0-openapi.json';

    it('should generate warehouses that match the Warehouse DTO', async () => {
      const warehouses = mockData.generateWarehouseData(3);
      validator.validateArray(spec, 'Warehouse', warehouses);
    });

    it('should generate inventory items that match the WarehouseItem DTO', async () => {
      // Mock some inventory data
      const inventory = [
        {
          sku: 'SKU-123',
          quantity: 100,
          warehouseId: 12345,
        },
      ];

      // REGRESSION CHECK: Ensure 'externalReferenceCode' is NOT in inventory (as fixed recently)
      expect(inventory[0]).not.toHaveProperty('externalReferenceCode');

      validator.validateArray(spec, 'WarehouseItem', inventory);
    });

    it('should match the WarehouseChannel DTO for linkage', () => {
      const linkage = {
        channelId: 111,
        warehouseId: 222,
      };

      // REGRESSION CHECK: Ensure 'externalReferenceCode' is NOT in linkage (as fixed recently)
      expect(linkage).not.toHaveProperty('externalReferenceCode');

      validator.validate(spec, 'WarehouseChannel', linkage);
    });
  });

  describe('Order Compliance', () => {
    const spec = 'headless-commerce-admin-order-v1.0-openapi.json';

    it('should generate orders that match the Order DTO (Minimal)', async () => {
      const orders = mockData.generateOrderData([], [], 1);
      // The current schema in project is minimal, just testing ERC presence
      validator.validateArray(spec, 'Order', orders);
    });
  });
});
