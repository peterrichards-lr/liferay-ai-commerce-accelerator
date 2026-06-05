/**
 * Maps Liferay API URL patterns to their authoritative OpenAPI schemas.
 */
const CONTRACT_MAPPINGS = [
  // --- OUTBOUND & BATCH CONTRACTS ---
  {
    pattern: /\/o\/headless-commerce-admin-catalog\/v1\.0\/products\/batch/,
    spec: 'headless-commerce-admin-catalog-v1.0-openapi.json',
    schema: 'Product',
    isBatch: true,
  },
  {
    pattern: /\/o\/headless-commerce-admin-catalog\/v1\.0\/products/,
    method: 'POST',
    spec: 'headless-commerce-admin-catalog-v1.0-openapi.json',
    schema: 'Product',
  },
  {
    pattern: /\/o\/headless-admin-user\/v1\.0\/accounts\/batch/,
    spec: 'headless-admin-user-v1.0-openapi.json',
    schema: 'Account',
    isBatch: true,
  },
  {
    pattern: /\/o\/headless-admin-user\/v1\.0\/accounts/,
    method: 'POST',
    spec: 'headless-admin-user-v1.0-openapi.json',
    schema: 'Account',
  },
  {
    pattern: /\/o\/headless-commerce-admin-inventory\/v1\.0\/warehouses\/batch/,
    spec: 'headless-commerce-admin-inventory-v1.0-openapi.json',
    schema: 'Warehouse',
    isBatch: true,
  },
  {
    pattern: /\/o\/headless-commerce-admin-inventory\/v1\.0\/warehouses/,
    method: 'POST',
    spec: 'headless-commerce-admin-inventory-v1.0-openapi.json',
    schema: 'Warehouse',
  },
  {
    pattern: /\/o\/headless-commerce-admin-pricing\/v2\.0\/price-lists\/batch/,
    spec: 'headless-commerce-admin-pricing-v2.0-openapi.json',
    schema: 'PriceList',
    isBatch: true,
  },
  {
    pattern: /\/o\/headless-commerce-admin-pricing\/v2\.0\/price-lists/,
    method: 'POST',
    spec: 'headless-commerce-admin-pricing-v2.0-openapi.json',
    schema: 'PriceList',
  },
  {
    pattern:
      /\/o\/headless-commerce-admin-pricing\/v2\.0\/price-entries\/batch/,
    spec: 'headless-commerce-admin-pricing-v2.0-openapi.json',
    schema: 'PriceEntry',
    isBatch: true,
  },
  {
    pattern:
      /\/o\/headless-commerce-admin-catalog\/v1\.0\/products\/\d+\/productOptions/,
    method: 'POST',
    spec: 'headless-commerce-admin-catalog-v1.0-openapi.json',
    schema: 'ProductOption',
    isArray: true,
  },

  // --- INBOUND RESPONSE CONTRACTS (GET) ---
  {
    pattern:
      /\/o\/headless-commerce-admin-catalog\/v1\.0\/products\/[a-zA-Z0-9-]+$/,
    method: 'GET',
    spec: 'headless-commerce-admin-catalog-v1.0-openapi.json',
    schema: 'Product',
    isInbound: true,
  },
  {
    pattern: /\/o\/headless-commerce-admin-catalog\/v1\.0\/products$/,
    method: 'GET',
    spec: 'headless-commerce-admin-catalog-v1.0-openapi.json',
    schema: 'Product',
    isInbound: true,
    isPage: true,
  },
  {
    pattern: /\/o\/headless-admin-user\/v1\.0\/accounts\/[a-zA-Z0-9-]+$/,
    method: 'GET',
    spec: 'headless-admin-user-v1.0-openapi.json',
    schema: 'Account',
    isInbound: true,
  },
  {
    pattern: /\/o\/headless-admin-user\/v1\.0\/accounts$/,
    method: 'GET',
    spec: 'headless-admin-user-v1.0-openapi.json',
    schema: 'Account',
    isInbound: true,
    isPage: true,
  },
  {
    pattern:
      /\/o\/headless-commerce-admin-pricing\/v2\.0\/price-lists\/[a-zA-Z0-9-]+$/,
    method: 'GET',
    spec: 'headless-commerce-admin-pricing-v2.0-openapi.json',
    schema: 'PriceList',
    isInbound: true,
  },
  {
    pattern: /\/o\/headless-commerce-admin-pricing\/v2\.0\/price-lists$/,
    method: 'GET',
    spec: 'headless-commerce-admin-pricing-v2.0-openapi.json',
    schema: 'PriceList',
    isInbound: true,
    isPage: true,
  },
];

/**
 * Finds a matching contract for a given URL and method.
 */
function findContract(url, method = 'GET') {
  return CONTRACT_MAPPINGS.find((m) => {
    const urlMatch = m.pattern.test(url);
    if (!urlMatch) return false;
    if (m.method && m.method !== method) return false;
    return true;
  });
}

module.exports = { findContract };
