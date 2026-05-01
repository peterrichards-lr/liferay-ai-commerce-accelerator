const ContractValidator = require('../services/contractValidator.cjs');

describe('ContractValidator', () => {
  let validator;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      DEBUG: true,
    };
    validator = new ContractValidator(mockCtx);
  });

  it('should validate a correct product payload', () => {
    const validProduct = {
      externalReferenceCode: 'PROD-1',
      name: { en_US: 'Test Product' },
      description: { en_US: 'Test Description' },
      productType: 'simple',
      active: true,
    };

    try {
      const result = validator.validate(
        'headless-commerce-admin-catalog-v1.0-openapi.json',
        'Product',
        validProduct
      );
      expect(result).toBe(true);
    } catch (err) {
      if (err.errors) mockCtx.logger.error('Validation Errors:', err.errors);
      throw err;
    }
  });

  it('should fail if field type is incorrect', () => {
    const invalidProduct = {
      externalReferenceCode: 'PROD-1',
      productStatus: 'Published', // Should be integer
    };

    expect(() => {
      validator.validate(
        'headless-commerce-admin-catalog-v1.0-openapi.json',
        'Product',
        invalidProduct
      );
    }).toThrow(/Data does not match Liferay API contract/);
  });
});
