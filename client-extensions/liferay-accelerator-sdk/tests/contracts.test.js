import { vi, describe, it, expect, beforeAll } from 'vitest';

const sdk = require('../src/index.js');
const { server } = require('./mocks/server.cjs');
const { http, HttpResponse } = require('msw');

describe('SDK Inbound Response Contract Validation', () => {
  let rest;
  let logger;

  beforeAll(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    };

    const ctx = {
      logger,
      DEBUG: true,
    };

    // Mock OAuthService to bypass Axis config credential checks
    ctx.oauth = {
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
      clearTokenCache: vi.fn(),
      applyConfig: vi.fn(),
    };

    // Instantiate ContractValidator and register it on context
    ctx.contractValidator = new sdk.ContractValidator(ctx);

    // Instantiate rest service with our validator ctx
    rest = new sdk.LiferayRestService(ctx);
  });

  it('should pass inbound validation when Liferay GET response perfectly matches PriceList DTO', async () => {
    // Corrected to perfectly match Liferay's official PriceList schema (requires flat name, type, and currencyCode)
    const mockPriceList = {
      id: 12345,
      externalReferenceCode: 'PL-123',
      name: 'Excellent Test Price List',
      catalogId: 100,
      currencyCode: 'USD',
      type: 'price-list',
    };

    server.use(
      http.get(
        '*/o/headless-commerce-admin-pricing/v2.0/price-lists/PL-123',
        () => {
          return HttpResponse.json(mockPriceList);
        }
      )
    );

    const data = await rest._request(
      {
        liferayUrl: 'http://localhost',
        validateInboundResponse: true,
        clientId: 'dummy-id',
        clientSecret: 'dummy-secret',
      },
      {
        url: '/o/headless-commerce-admin-pricing/v2.0/price-lists/PL-123',
        method: 'GET',
      }
    );
    expect(data.id).toBe(12345);
    expect(data.externalReferenceCode).toBe('PL-123');
  });

  it('should throw ContractViolationError and catch platform drifts when Liferay GET response violates contract', async () => {
    // PriceList DTO requires 'catalogId', 'name', 'type', and 'currencyCode' to be valid.
    // Here we supply a missing name and missing catalogId.
    const invalidPriceList = {
      id: 55555,
      externalReferenceCode: 'PL-BAD',
    };

    server.use(
      http.get(
        '*/o/headless-commerce-admin-pricing/v2.0/price-lists/PL-BAD',
        () => {
          return HttpResponse.json(invalidPriceList);
        }
      )
    );

    await expect(
      rest._request(
        {
          liferayUrl: 'http://localhost',
          validateInboundResponse: true,
          clientId: 'dummy-id',
          clientSecret: 'dummy-secret',
        },
        {
          url: '/o/headless-commerce-admin-pricing/v2.0/price-lists/PL-BAD',
          method: 'GET',
        }
      )
    ).rejects.toThrow();

    // Verify logger output the violation
    expect(logger.error).toHaveBeenCalled();
  });

  describe('ContractValidator Direct Validation', () => {
    let validator;

    beforeAll(() => {
      // Access the contractValidator instance from our configured context
      validator = rest.ctx.contractValidator;
    });

    it('should throw error when validating against a non-existent schema', () => {
      expect(() => {
        validator.validate(
          'headless-commerce-admin-pricing-v2.0-openapi.json',
          'NonExistentSchema',
          {}
        );
      }).toThrow(/Schema not found/);
    });

    it('should throw error when validateArray is called with a non-array input', () => {
      expect(() => {
        validator.validateArray(
          'headless-commerce-admin-pricing-v2.0-openapi.json',
          'PriceList',
          {}
        );
      }).toThrow('Data must be an array for validateArray');
    });

    it('should successfully validate an array of correct items', () => {
      const validItems = [
        {
          id: 123,
          externalReferenceCode: 'PL-1',
          name: 'PL 1',
          catalogId: 10,
          currencyCode: 'USD',
          type: 'price-list',
        },
        {
          id: 456,
          externalReferenceCode: 'PL-2',
          name: 'PL 2',
          catalogId: 10,
          currencyCode: 'USD',
          type: 'price-list',
        },
      ];

      const result = validator.validateArray(
        'headless-commerce-admin-pricing-v2.0-openapi.json',
        'PriceList',
        validItems
      );
      expect(result).toBe(true);
    });

    it('should throw error indicating the correct failed index when one array item is invalid', () => {
      const invalidItems = [
        {
          id: 123,
          externalReferenceCode: 'PL-1',
          name: 'PL 1',
          catalogId: 10,
          currencyCode: 'USD',
          type: 'price-list',
        },
        {
          id: 456,
          externalReferenceCode: 'PL-2',
          // name is missing, violating contract
          catalogId: 10,
          currencyCode: 'USD',
          type: 'price-list',
        },
      ];

      expect(() => {
        validator.validateArray(
          'headless-commerce-admin-pricing-v2.0-openapi.json',
          'PriceList',
          invalidItems
        );
      }).toThrow(/Item at index 1 failed contract/);
    });

    describe('_handleOpenApiSpecifics', () => {
      it('should convert exclusiveMinimum when true and minimum is present', () => {
        const schema = { exclusiveMinimum: true, minimum: 5 };
        validator._handleOpenApiSpecifics(schema);
        expect(schema.exclusiveMinimum).toBe(5);
        expect(schema.minimum).toBeUndefined();
      });

      it('should delete exclusiveMinimum if false or minimum is absent', () => {
        const schema = { exclusiveMinimum: false, minimum: 5 };
        validator._handleOpenApiSpecifics(schema);
        expect(schema.exclusiveMinimum).toBeUndefined();
        expect(schema.minimum).toBe(5);
      });

      it('should convert exclusiveMaximum when true and maximum is present', () => {
        const schema = { exclusiveMaximum: true, maximum: 10 };
        validator._handleOpenApiSpecifics(schema);
        expect(schema.exclusiveMaximum).toBe(10);
        expect(schema.maximum).toBeUndefined();
      });

      it('should delete exclusiveMaximum if false or maximum is absent', () => {
        const schema = { exclusiveMaximum: false, maximum: 10 };
        validator._handleOpenApiSpecifics(schema);
        expect(schema.exclusiveMaximum).toBeUndefined();
        expect(schema.maximum).toBe(10);
      });

      it('should convert nullable to array type containing null', () => {
        // Test single type string
        const schema1 = { type: 'string', nullable: true };
        validator._handleOpenApiSpecifics(schema1);
        expect(schema1.type).toEqual(['string', 'null']);
        expect(schema1.nullable).toBeUndefined();

        // Test array types
        const schema2 = { type: ['number'], nullable: true };
        validator._handleOpenApiSpecifics(schema2);
        expect(schema2.type).toEqual(['number', 'null']);
        expect(schema2.nullable).toBeUndefined();

        // Test array types that already contain null
        const schema3 = { type: ['string', 'null'], nullable: true };
        validator._handleOpenApiSpecifics(schema3);
        expect(schema3.type).toEqual(['string', 'null']);
        expect(schema3.nullable).toBeUndefined();
      });
    });
  });
});
