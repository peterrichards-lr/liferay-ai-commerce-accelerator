import { http, HttpResponse } from 'msw';

// Unified validation logic for mock handlers
function validateRequest(request, _data, _op) {
  // basic check for auth
  const auth = request.headers.get('Authorization');
  if (!auth) {
    return HttpResponse.json(
      { error: 'Unauthorized', message: 'Missing Authorization header' },
      { status: 401 }
    );
  }
  return null;
}

const handlers = [
  // Mock OAuth Token
  http.post('*/o/oauth2/token', async () => {
    return HttpResponse.json({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }),

  // Mock My User Account
  http.get('*/o/headless-admin-user/v1.0/my-user-account', () => {
    return HttpResponse.json({
      id: 1,
      emailAddress: 'test@liferay.com',
      defaultAccountId: 10,
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
            id: 1,
            productId: 1,
            externalReferenceCode: 'PROD-1',
            name: 'Test Product 1', // Flat string for test compatibility
            sku: 'SKU-1',
            catalogId,
          },
        ],
        totalCount: 1,
      });
    }
  ),

  // Mock Product by ID
  http.get(
    '*/o/headless-commerce-admin-catalog/v1.0/products/:productId',
    ({ params }) => {
      return HttpResponse.json({
        id: parseInt(params.productId, 10),
        productId: parseInt(params.productId, 10),
        externalReferenceCode: `PROD-${params.productId}`,
        name: `Product ${params.productId}`,
      });
    }
  ),

  // Mock Accounts List
  http.get('*/o/headless-admin-user/v1.0/accounts', () => {
    return HttpResponse.json({
      items: [
        {
          id: 10,
          externalReferenceCode: 'ACC-1',
          name: 'Test Account 1',
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Orders List
  http.get('*/o/headless-commerce-admin-order/v1.0/orders', () => {
    return HttpResponse.json({
      items: [
        {
          id: 20,
          externalReferenceCode: 'ORD-1', // Match test expectation
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
          id: 30,
          externalReferenceCode: 'PL-1',
          name: 'Test Price List 1',
          type: 'price-list',
          catalogId: 123, // MUST match the test catalogId
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Price List Detail for Contract Testing
  http.get(
    '*/o/headless-commerce-admin-pricing/v2.0/price-lists/PL-123',
    () => {
      return HttpResponse.json({
        id: 12345,
        externalReferenceCode: 'PL-123',
        name: 'Excellent Test Price List',
        catalogId: 100,
        currencyCode: 'USD',
        type: 'price-list',
      });
    }
  ),
  http.get(
    '*/o/headless-commerce-admin-pricing/v2.0/price-lists/PL-BAD',
    () => {
      return HttpResponse.json({
        id: 55555,
        externalReferenceCode: 'PL-BAD',
      });
    }
  ),

  // Mock Warehouses
  http.get('*/o/headless-commerce-admin-inventory/v1.0/warehouses', () => {
    return HttpResponse.json({
      items: [
        {
          id: 40,
          externalReferenceCode: 'WH-1',
          name: 'Test Warehouse 1',
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Catalogs List
  http.get('*/o/headless-commerce-admin-catalog/v1.0/catalogs', () => {
    return HttpResponse.json({
      items: [
        {
          id: 123,
          externalReferenceCode: 'CAT-1',
          name: { en_US: 'Test Catalog 1' },
          defaultLanguageId: 'en_US',
          currencyCode: 'USD',
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Channels List
  http.get('*/o/headless-commerce-admin-channel/v1.0/channels', () => {
    return HttpResponse.json({
      items: [
        {
          id: 456,
          externalReferenceCode: 'CHAN-1',
          name: { en_US: 'Test Channel 1' },
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Currencies List
  http.get('*/o/headless-commerce-admin-catalog/v1.0/currencies', () => {
    return HttpResponse.json({
      items: [
        {
          code: 'USD',
          name: { en_US: 'US Dollar' },
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Languages List
  http.get('*/o/headless-admin-user/v1.0/languages', () => {
    return HttpResponse.json({
      items: [
        {
          id: 'en_US',
          name: 'English (United States)',
        },
      ],
      totalCount: 1,
    });
  }),

  // Mock Product Options
  http.get(
    '*/o/headless-commerce-admin-catalog/v1.0/products/:id/productOptions',
    () => {
      return HttpResponse.json({
        items: [],
        totalCount: 0,
      });
    }
  ),

  // Mock Product Options (POST)
  http.post(
    '*/o/headless-commerce-admin-catalog/v1.0/products/:id/productOptions',
    async ({ params: _params, request }) => {
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
      if (Array.isArray(data.items)) {
        const errorResponse = validateRequest(request, data.items, 'POST');
        if (errorResponse) return errorResponse;
      }
      return HttpResponse.json({
        id: 9001,
        className: params.className,
        externalReferenceCode: 'MOCK-BATCH-ERC',
        status: 'INITIAL',
      });
    }
  ),

  // Mock Batch Engine - Status (GET)
  http.get(
    '*/o/headless-batch-engine/v1.0/import-task/:batchId',
    ({ params }) => {
      return HttpResponse.json({
        id: parseInt(params.batchId, 10),
        status: 'COMPLETED',
        executeStatus: 'COMPLETED', // Match test expectation
        processedItemsCount: 10,
        totalItemsCount: 10,
      });
    }
  ),

  // --- Page Management (LPD-35443) Mocks ---
  http.get('*/o/headless-admin-site/v1.0/sites/:siteKey/site-pages', () => {
    return HttpResponse.json({
      items: [{ externalReferenceCode: 'PAGE-1', name: 'Test Page 1' }],
      totalCount: 1,
    });
  }),
  http.post(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/site-pages',
    async ({ request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: data.externalReferenceCode || 'PAGE-1',
        name: data.name || 'Test Page 1',
      });
    }
  ),
  http.get(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/site-pages/:pageKey',
    ({ params }) => {
      return HttpResponse.json({
        externalReferenceCode: params.pageKey,
        name: 'Test Page 1',
      });
    }
  ),
  http.put(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/site-pages/:pageKey',
    async ({ params, request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: params.pageKey,
        name: data.name || 'Updated Test Page 1',
      });
    }
  ),
  http.delete(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/site-pages/:pageKey',
    () => {
      return new HttpResponse(null, { status: 204 });
    }
  ),
  http.patch(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/site-pages/:pageKey',
    async ({ params, request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: params.pageKey,
        name: data.name || 'Patched Test Page 1',
      });
    }
  ),

  // --- Page Template Mocks ---
  http.get('*/o/headless-admin-site/v1.0/sites/:siteKey/page-templates', () => {
    return HttpResponse.json({
      items: [{ externalReferenceCode: 'TEMPLATE-1', name: 'Test Template 1' }],
      totalCount: 1,
    });
  }),
  http.post(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-templates',
    async ({ request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: data.externalReferenceCode || 'TEMPLATE-1',
        name: data.name || 'Test Template 1',
      });
    }
  ),
  http.get(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-templates/:templateKey',
    ({ params }) => {
      return HttpResponse.json({
        externalReferenceCode: params.templateKey,
        name: 'Test Template 1',
      });
    }
  ),
  http.put(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-templates/:templateKey',
    async ({ params, request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: params.templateKey,
        name: data.name || 'Updated Test Template 1',
      });
    }
  ),
  http.delete(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-templates/:templateKey',
    () => {
      return new HttpResponse(null, { status: 204 });
    }
  ),
  http.patch(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-templates/:templateKey',
    async ({ params, request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: params.templateKey,
        name: data.name || 'Patched Test Template 1',
      });
    }
  ),

  // --- Page Template Set Mocks ---
  http.get(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-template-sets',
    () => {
      return HttpResponse.json({
        items: [{ externalReferenceCode: 'SET-1', name: 'Test Set 1' }],
        totalCount: 1,
      });
    }
  ),
  http.post(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-template-sets',
    async ({ request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: data.externalReferenceCode || 'SET-1',
        name: data.name || 'Test Set 1',
      });
    }
  ),
  http.get(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-template-sets/:setKey',
    ({ params }) => {
      return HttpResponse.json({
        externalReferenceCode: params.setKey,
        name: 'Test Set 1',
      });
    }
  ),
  http.put(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-template-sets/:setKey',
    async ({ params, request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: params.setKey,
        name: data.name || 'Updated Test Set 1',
      });
    }
  ),
  http.delete(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-template-sets/:setKey',
    () => {
      return new HttpResponse(null, { status: 204 });
    }
  ),
  http.patch(
    '*/o/headless-admin-site/v1.0/sites/:siteKey/page-template-sets/:setKey',
    async ({ params, request }) => {
      const data = await request.json();
      return HttpResponse.json({
        externalReferenceCode: params.setKey,
        name: data.name || 'Patched Test Set 1',
      });
    }
  ),

  // Mock AICA Reindex endpoints
  http.post('*/o/aica-reindex/reindex/all', () => {
    return HttpResponse.json({
      status: 'success',
      message: 'All indexes scheduled for reindexing',
    });
  }),
  http.post('*/o/aica-reindex/reindex/:className', ({ params }) => {
    return HttpResponse.json({
      status: 'success',
      className: params.className,
      message: `Reindex scheduled for ${params.className}`,
    });
  }),
];

export { handlers };
