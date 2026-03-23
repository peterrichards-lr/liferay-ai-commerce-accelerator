/**
 * payload-cleaner.cjs
 * Recursive utility to remove forbidden numeric IDs from Liferay payloads.
 */

function deepCleanIds(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(deepCleanIds);
  }

  const cleaned = { ...obj };
  const forbidden = ['id', 'productId', 'accountId', 'skuId', 'addressId'];

  for (const key of forbidden) {
    delete cleaned[key];
  }

  for (const key in cleaned) {
    if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
      cleaned[key] = deepCleanIds(cleaned[key]);
    }
  }

  return cleaned;
}

module.exports = { deepCleanIds };
