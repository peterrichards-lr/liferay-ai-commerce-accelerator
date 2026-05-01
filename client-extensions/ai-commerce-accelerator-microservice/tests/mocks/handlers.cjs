const { http, HttpResponse } = require('msw');
const ContractValidator = require('../../services/contractValidator.cjs');
const { findContract } = require('../../utils/contractMappings.cjs');
const { logger } = require('../../utils/logger.cjs');

// Mock context for the validator
const mockCtx = {
  logger,
  DEBUG: true,
};
const validator = new ContractValidator(mockCtx);

function validateRequest(request, data, method = 'POST') {
  const contract = findContract(request.url, method);
  if (contract) {
    try {
      if (contract.isBatch && Array.isArray(data)) {
        // Validate first item as a sample
        if (data.length > 0) {
          validator.validate(contract.spec, contract.schema, data[0]);
        }
      } else {
        validator.validate(contract.spec, contract.schema, data);
      }
    } catch (err) {
      if (err.name === 'ContractViolationError') {
        return HttpResponse.json(
          {
            error: 'ContractViolation',
            message: err.message,
            errors: err.errors,
          },
          { status: 400 }
        );
      }
    }
  }
  return null;
}

const handlers = [
  // Mock OAuth Token
  http.post('*/o/oauth2/token', () => {
    return HttpResponse.json({
      access_token: 'test-token',
      expires_in: 3600,
    });
  }),

  // Mock Products List
  http.get(
    '*/o/headless-commerce-admin-catalog/v1.0/products',
    ({ request }) => {
      const url = new URL(request.url);
      const filter = url.searchParams.get('filter') || '';
      const catalogIdMatch = filter.match(/catalogId eq (\d+)/);
      const catalogId = catalogIdMatch ? parseInt(catalogIdMatch[1], 10) : 100;

      return HttpResponse.json({
        items: [
          {
            id: 123,
            externalReferenceCode: 'PROD-1',
            name: 'Test Product 1',
            catalogId: catalogId,
          },
        ],
        totalCount: 1,
      });
    }
  ),

  // Mock Countries List
  http.get('*/o/headless-admin-address/v1.0/countries', () => {
    return HttpResponse.json({
      items: [
        {
          id: 1,
          a2: 'US',
          name: 'United States',
          number: 840,
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Accounts List
  http.get('*/o/headless-admin-user/v1.0/accounts', () => {
    return HttpResponse.json({
      items: [
        {
          id: 1001,
          externalReferenceCode: 'ACC-1',
          name: 'Test Account 1',
          type: 'business',
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Catalogs List
  http.get(
    '*/o/headless-commerce-admin-catalog/v1.0/catalogs',
    ({ request }) => {
      return HttpResponse.json({
        items: [
          {
            id: 123,
            externalReferenceCode: 'CAT-1',
            name: 'Test Catalog 1',
            defaultLanguageId: 'en_US',
            currencyCode: 'USD',
          },
        ],
        totalCount: 1,
      });
    }
  ),

  // Mock Orders List
  http.get('*/o/headless-commerce-admin-order/v1.0/orders', () => {
    return HttpResponse.json({
      items: [
        {
          id: 2001,
          externalReferenceCode: 'ORD-1',
          orderStatus: 1,
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Price Lists
  http.get('*/o/headless-commerce-admin-pricing/v2.0/price-lists', () => {
    return HttpResponse.json({
      items: [
        {
          id: 3001,
          externalReferenceCode: 'PL-1',
          name: 'Test Price List 1',
          catalogId: 123,
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Price Entries
  http.get('*/o/headless-commerce-admin-pricing/v2.0/price-entries', () => {
    return HttpResponse.json({
      items: [
        {
          id: 4001,
          externalReferenceCode: 'PE-1',
          price: 99.99,
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Warehouses List
  http.get('*/o/headless-commerce-admin-inventory/v1.0/warehouses', () => {
    return HttpResponse.json({
      items: [
        {
          id: 5001,
          externalReferenceCode: 'WH-1',
          name: 'Test Warehouse 1',
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Product Options (POST)
  http.post(
    '*/o/headless-commerce-admin-catalog/v1.0/products/:id/productOptions',
    async ({ params, request }) => {
      const data = await request.json();
      const errorResponse = validateRequest(request, data, 'POST');
      if (errorResponse) return errorResponse;

      return HttpResponse.json(data);
    }
  ),

  // Mock Batch Engine - Submit (POST)
  http.post(
    '*/o/headless-batch-engine/v1.0/import-task/:className',
    async ({ params, request }) => {
      const data = await request.json();

      // If it's a JSON batch, validate items
      if (Array.isArray(data.items)) {
        const errorResponse = validateRequest(request, data.items, 'POST');
        if (errorResponse) return errorResponse;
      }

      return HttpResponse.json({
        id: 9001,
        executeStatus: 'STARTED',
        className: params.className,
      });
    }
  ),

  // Mock Batch Engine - Status (GET)
  http.get(
    '*/o/headless-batch-engine/v1.0/import-task/:batchId',
    ({ params }) => {
      return HttpResponse.json({
        id: parseInt(params.batchId, 10),
        executeStatus: 'COMPLETED',
        processedItemsCount: 10,
        totalItemsCount: 10,
      });
    }
  ),

  // Mock GraphQL
  http.post('*/o/graphql', async ({ request }) => {
    const { query } = await request.json();

    if (query.includes('products')) {
      return HttpResponse.json({
        data: {
          headlessCommerceAdminCatalog_v1_0: {
            products: {
              items: [
                {
                  productId: 123,
                  externalReferenceCode: 'PROD-1',
                  name: 'Test Product 1',
                  id: 123,
                  catalogId: 123,
                },
              ],
              totalCount: 1,
            },
          },
        },
      });
    }

    if (query.includes('accounts')) {
      return HttpResponse.json({
        data: {
          headlessAdminUser_v1_0: {
            accounts: {
              items: [
                {
                  id: 1001,
                  externalReferenceCode: 'ACC-1',
                  name: 'Test Account 1',
                  type: 'business',
                },
              ],
              totalCount: 1,
            },
          },
        },
      });
    }

    if (query.includes('orders')) {
      return HttpResponse.json({
        data: {
          headlessCommerceAdminOrder_v1_0: {
            orders: {
              items: [
                {
                  id: 2001,
                  externalReferenceCode: 'ORD-1',
                  orderStatus: 1,
                },
              ],
              totalCount: 1,
            },
          },
        },
      });
    }

    if (query.includes('priceLists')) {
      return HttpResponse.json({
        data: {
          headlessCommerceAdminPricing_v2_0: {
            priceLists: {
              items: [
                {
                  id: 3001,
                  externalReferenceCode: 'PL-1',
                  name: 'Test Price List 1',
                },
              ],
              totalCount: 1,
            },
          },
        },
      });
    }

    if (query.includes('warehouses')) {
      return HttpResponse.json({
        data: {
          headlessCommerceAdminInventory_v1_0: {
            warehouses: {
              items: [
                {
                  id: 5001,
                  externalReferenceCode: 'WH-1',
                  name: 'Test Warehouse 1',
                },
              ],
              totalCount: 1,
            },
          },
        },
      });
    }

    return HttpResponse.json({ data: {} });
  }),
  // Mock OpenAI
  http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              products: [
                {
                  name: { en_US: 'AI Product' },
                  description: { en_US: 'AI Description' },
                  shortDescription: { en_US: 'AI Short' },
                  urls: { en_US: 'ai-product' },
                  baseSku: 'AI-SKU',
                  productType: 'simple',
                  externalReferenceCode: 'AICA-PRD-AI',
                  skus: [
                    {
                      sku: 'AI-SKU',
                      cost: 50,
                      price: 100,
                      inventoryLevel: 10,
                      published: true,
                      purchasable: true,
                      neverExpire: true,
                      externalReferenceCode: 'AI-SKU',
                    },
                  ],
                },
              ],
            }),
          },
        },
      ],
    });
  }),
];

module.exports = { handlers };
