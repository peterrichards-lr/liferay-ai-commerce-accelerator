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
});
