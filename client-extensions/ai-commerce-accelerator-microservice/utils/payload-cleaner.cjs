/**
 * payload-cleaner.cjs
 * Hardened utility to ensure we NEVER send internal Liferay IDs
 * unless they were explicitly returned by Liferay (Resolved).
 */

function deepCleanIds(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(deepCleanIds);
  }

  const cleaned = { ...obj };

  /**
   * Rule 1: Always remove the root 'id' field.
   * Root IDs are system-generated and should never be sent in an UPSERT.
   */
  if ('id' in cleaned) {
    delete cleaned.id;
  }

  /**
   * Rule 2: Never guess internal database IDs for relationships.
   * If an ID is a placeholder (0, null, or in a mock range),
   * it must be stripped to force Liferay to use the ERC.
   */
  const relationalIdFields = [
    'productId',
    'skuId',
    'accountId',
    'addressId',
    'priceListId',
    'defaultBillingAddressId',
    'defaultShippingAddressId',
  ];

  for (const key of relationalIdFields) {
    if (!(key in cleaned)) continue;

    const value = cleaned[key];

    // Check for "Non-Resolved" values
    const isPlaceholder =
      value === 0 ||
      value === null ||
      value === undefined ||
      (typeof value === 'number' &&
        ((value >= 10000 && value <= 19999) || // Mock Accounts
          (value >= 30000 && value <= 39999) || // Mock Products
          (value >= 40000 && value <= 59999))); // Mock SKUs/Variants

    if (isPlaceholder) {
      delete cleaned[key];
    }
  }

  // Recurse into nested objects
  for (const key in cleaned) {
    if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
      if (typeof cleaned[key] === 'object' && cleaned[key] !== null) {
        // Special case: Remove externalReferenceCode from nested 'sku' objects in PriceEntry payloads
        if (key === 'sku' && 'skuExternalReferenceCode' in cleaned) {
          delete cleaned[key].externalReferenceCode;
        }

        cleaned[key] = deepCleanIds(cleaned[key]);

        // Final Safety: If a nested object like 'sku: { id: 40000 }' resulted
        // in an empty object 'sku: {}', remove the parent key entirely.
        if (
          Object.keys(cleaned[key]).length === 0 &&
          !Array.isArray(cleaned[key])
        ) {
          delete cleaned[key];
        }
      }
    }
  }

  return cleaned;
}

module.exports = { deepCleanIds };
