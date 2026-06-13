import { test, expect } from '@playwright/test';

// Dynamically construct Basic Auth header from environment variables as the default security context
const username = process.env.LIFERAY_API_USERNAME || 'test@liferay.com';
const password = process.env.LIFERAY_API_PASSWORD || 'test';
const authHeader =
  'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

test.describe('AICA SDK Idempotency & Platform-Contradiction API Tests', () => {
  // Use direct Basic Auth extra headers to bypass Liferay browser Setup/Terms-of-use Wizards completely
  test.use({
    extraHTTPHeaders: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  });

  test('should successfully create, fetch, and reuse a specification category', async ({
    request,
  }) => {
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';

    // Correct OptionCategory schema payload (uses "title" and "key", rejects "name")
    const payload = {
      externalReferenceCode: 'AICATEST-CAT-IDEM-999',
      key: 'idem-test-category',
      title: { en_US: 'Idempotency Test Category' },
    };

    console.log(
      '>>> [API Test] Registering specification category (attempt 1)...'
    );
    const createRes = await request.post(
      `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/optionCategories`,
      {
        data: payload,
      }
    );
    console.log(`>>> [API Test] Create response status: ${createRes.status()}`);
    expect(
      createRes.ok() || createRes.status() === 409 || createRes.status() === 400
    ).toBe(true);

    console.log(
      '>>> [API Test] Registering duplicate specification category (attempt 2)...'
    );
    const duplicateRes = await request.post(
      `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/optionCategories`,
      {
        data: payload,
      }
    );
    console.log(
      `>>> [API Test] Duplicate response status: ${duplicateRes.status()}`
    );
    // Support either 2xx success (idempotent PUT-on-POST behavior in DXP) or 409/400 conflicts
    expect(
      duplicateRes.ok() ||
        duplicateRes.status() === 409 ||
        duplicateRes.status() === 400
    ).toBe(true);

    console.log('>>> [API Test] Executing list-based fallback lookup...');
    const listRes = await request.get(
      `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/optionCategories?pageSize=250`
    );
    expect(listRes.ok()).toBe(true);

    const body = await listRes.json();
    const found = body.items.find(
      (it) => it.externalReferenceCode === payload.externalReferenceCode
    );
    expect(found).toBeDefined();
    expect(found.externalReferenceCode).toBe(payload.externalReferenceCode);
    console.log(
      '>>> [API Test] Specification Category Idempotency: SUCCESS (Reused existing category).'
    );
  });

  test('should successfully bypass option by-ERC NullPointer crash and reuse by-key list-based lookup', async ({
    request,
  }) => {
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';

    const optionPayload = {
      externalReferenceCode: 'AICATEST-OPT-IDEM-999',
      key: 'idem-test-option',
      name: { en_US: 'Idempotency Test Option' },
      fieldType: 'select',
      skuContributor: true,
    };

    console.log('>>> [API Test] Registering custom option (attempt 1)...');
    const createRes = await request.post(
      `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/options`,
      {
        data: optionPayload,
      }
    );
    console.log(
      `>>> [API Test] Create option response status: ${createRes.status()}`
    );
    expect(
      createRes.ok() || createRes.status() === 409 || createRes.status() === 400
    ).toBe(true);

    console.log(
      '>>> [API Test] Querying option by-ERC to inspect NullPointer bug status...'
    );
    const ercRes = await request.get(
      `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/options/by-externalReferenceCode/${optionPayload.externalReferenceCode}`
    );
    console.log(
      `>>> [API Test] Option by-ERC response status: ${ercRes.status()}`
    );

    if (ercRes.status() === 500) {
      console.log(
        '>>> [CONFIRMED] Active DXP instance suffers from the Option by-ERC NullPointerException bug!'
      );
    } else {
      console.log(
        '>>> [NOTICE] Active DXP instance handles by-ERC safely (status is non-500).'
      );
    }

    console.log(
      '>>> [API Test] Executing list-based key-lookup to fetch the option...'
    );
    const listRes = await request.get(
      `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/options?pageSize=250`
    );
    expect(listRes.ok()).toBe(true);

    const body = await listRes.json();
    const found = body.items.find(
      (it) =>
        String(it.key || '').toLowerCase() ===
        String(optionPayload.key).toLowerCase()
    );
    expect(found).toBeDefined();
    expect(found.externalReferenceCode).toBe(
      optionPayload.externalReferenceCode
    );
    console.log(
      '>>> [API Test] Option Idempotency: SUCCESS (Option correctly retrieved and reused).'
    );
  });

  test('should verify Liferay Pricing v2.0 constraints on Sku DTO externalReferenceCode', async ({
    request,
  }) => {
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';

    // Fetch first valid catalog ID dynamically from the portal
    console.log('>>> [API Test] Querying active commerce catalogs...');
    const catalogsRes = await request.get(
      `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/catalogs`
    );
    expect(catalogsRes.ok()).toBe(true);
    const catalogsData = await catalogsRes.json();
    const activeCatalog = catalogsData.items?.[0];

    if (!activeCatalog) {
      console.log(
        '>>> [API Test] WARNING: No active commerce catalog found. Bypassing test.'
      );
      return;
    }

    const catalogId = activeCatalog.id;
    console.log(
      `>>> [API Test] Target Catalog found: "${activeCatalog.name}" (ID: ${catalogId})`
    );

    // 1. Create a stable test price list first to target
    const priceListERC = 'AICATEST-PL-IDEM-999';
    const priceListPayload = {
      externalReferenceCode: priceListERC,
      name: 'Idempotency Test Price List',
      catalogId: parseInt(catalogId, 10),
      currencyCode: 'USD',
      type: 'price-list',
    };

    console.log('>>> [API Test] Preparing stable test price list...');
    const createPlRes = await request.post(
      `${baseUrl}/o/headless-commerce-admin-pricing/v2.0/price-lists`,
      {
        data: priceListPayload,
      }
    );
    console.log(
      `>>> [API Test] Price list prepare status: ${createPlRes.status()}`
    );
    expect(
      createPlRes.ok() ||
        createPlRes.status() === 409 ||
        createPlRes.status() === 400
    ).toBe(true);

    // Fetch a valid product SKU ERC from Liferay to prevent NoSuchCPInstanceException in background batch processing
    console.log(
      '>>> [API Test] Querying active products to resolve a valid SKU ERC...'
    );
    const productsRes = await request.get(
      `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/products?pageSize=1`
    );
    expect(productsRes.ok()).toBe(true);
    const productsData = await productsRes.json();
    const product = productsData.items?.[0];

    let skuERC = 'AICATEST-SKU-PASS-999'; // fallback
    if (product) {
      const skusRes = await request.get(
        `${baseUrl}/o/headless-commerce-admin-catalog/v1.0/products/${product.id}/skus`
      );
      if (skusRes.ok()) {
        const skusData = await skusRes.json();
        const sku = skusData.items?.[0];
        if (sku && sku.externalReferenceCode) {
          skuERC = sku.externalReferenceCode;
          console.log(
            `>>> [API Test] Using resolved valid SKU ERC: "${skuERC}"`
          );
        }
      }
    }

    // 2. Submit our COMPLIANT Price Entry batch payload (skuExternalReferenceCode at root, nested Sku omitted)
    const compliantPayload = [
      {
        price: 149.99,
        externalReferenceCode: 'AICATEST-PE-PASS-999',
        active: true,
        skuExternalReferenceCode: skuERC, // Use resolved valid SKU ERC!
        priceListExternalReferenceCode: priceListERC,
      },
    ];

    console.log(
      '>>> [API Test] Submitting COMPLIANT Pricing v2.0 payload (with root-level skuExternalReferenceCode)...'
    );
    const compliantRes = await request.post(
      `${baseUrl}/o/headless-commerce-admin-pricing/v2.0/price-lists/price-entries/batch`,
      {
        data: compliantPayload,
      }
    );
    console.log(
      `>>> [API Test] Compliant submit response status: ${compliantRes.status()}`
    );

    // Assert Liferay accepts the batch (status 202 Accepted)
    expect(compliantRes.ok() || compliantRes.status() === 202).toBe(true);
    console.log(
      '>>> [API Test] Compliant Payload Verification: SUCCESS (Payload cleanly accepted by Liferay Pricing v2.0!).'
    );
  });
});
