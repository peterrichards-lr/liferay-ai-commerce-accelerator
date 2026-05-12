/**
 * Utility functions for processing Liferay API responses (REST and GraphQL).
 */

/**
 * Extract items from a Liferay API response.
 * Handles both flat arrays and paginated response objects.
 *
 * @param {any} data The response data from Liferay.
 * @returns {Array} An array of items.
 */
function asItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

/**
 * Extract the total count from a Liferay API response.
 *
 * @param {any} data The response data from Liferay.
 * @returns {number} The total count of items.
 */
function asCount(data) {
  if (typeof data?.totalCount === 'number') return data.totalCount;
  if (typeof data?.items?.totalCount === 'number') return data.items.totalCount;
  return asItems(data).length;
}

module.exports = {
  asItems,
  asCount,
};
