const axios = require('axios');

class LiferayGraphQLService {
  constructor(config) {
    this.baseURL = config.baseURL || 'http://localhost:8080/o/graphql';
    this.auth = config.auth;
    this.maxBatchSize = config.maxBatchSize || 50;
    // Retry Settings
    this.maxRetries = config.maxRetries || 3;
    this.initialDelay = config.initialDelay || 1000; // 1 second
  }

  /**
   * Universal fetcher with Exponential Backoff
   */
  async _fetchByERCs(namespace, queryMethod, ercs, fields) {
    if (!Array.isArray(ercs) || ercs.length === 0) {
      throw new Error(`The "ercs" argument must be a non-empty array.`);
    }

    const chunks = this._chunkArray(ercs, this.maxBatchSize);
    let allResults = [];

    for (const batch of chunks) {
      const result = await this._executeWithRetry(async () => {
        const fieldSelection = fields.join(' ');
        const aliasedQueries = batch.map((erc, index) => `
          a${index}: ${queryMethod}(externalReferenceCode: "${erc}") { ${fieldSelection} }
        `).join('\n');

        const gqlBody = { query: `query { ${namespace} { ${aliasedQueries} } }` };
        const response = await axios.post(this.baseURL, gqlBody, { auth: this.auth });
        
        const data = response.data.data[namespace];
        const results = Object.values(data);

        // TRIGGER RETRY: If any ERC returned null, the index might be stale.
        // We only return the batch if EVERY requested ERC was found.
        if (results.some(item => item === null)) {
          throw new Error('STALE_INDEX'); 
        }

        return results;
      });

      allResults = allResults.concat(result);
    }
    return allResults;
  }

  /**
   * Internal retry logic using Exponential Backoff
   */
  async _executeWithRetry(fn, attempt = 0) {
    try {
      return await fn();
    } catch (error) {
      if (error.message === 'STALE_INDEX' && attempt < this.maxRetries) {
        const delay = this.initialDelay * Math.pow(2, attempt);
        console.warn(`[Liferay SDK] Index stale. Retrying in ${delay}ms (Attempt ${attempt + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._executeWithRetry(fn, attempt + 1);
      }
      throw error; // Re-throw if max retries reached or it's a real 500/400 error
    }
  }

  // --- Wrapper Methods ---

  async getAccountsByERC(ercs, fields = ['id', 'externalReferenceCode', 'name']) {
    return this._fetchByERCs('headlessAdminUser_v1_0', 'accountByExternalReferenceCode', ercs, fields);
  }

  _chunkArray(arr, size) {
    return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
  }
}

module.exports = LiferayGraphQLService;