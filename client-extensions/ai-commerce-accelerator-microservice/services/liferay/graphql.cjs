const axios = require('axios');

class LiferayGraphQLService {
  constructor(ctx) {
    this.ctx = ctx;
    this.liferayUrl = ctx.liferayUrl;
    this.oauth = ctx.oauth;
    this.logger = ctx.logger;
    this.maxBatchSize = 50;
    // Retry Settings
    this.maxRetries = 3;
    this.initialDelay = 1000; // 1 second
  }

  async _getClient(config) {
    const accessToken = await this.oauth.getAccessToken(
      config.liferayUrl,
      config.clientId,
      config.clientSecret
    );

    return axios.create({
      baseURL: `${config.liferayUrl}/o/graphql`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async _fetchByFilter(config, namespace, queryMethod, filter, fields, pagination) {
    const client = await this._getClient(config);
    const fieldSelection = fields.join(' ');
    const { page, pageSize } = pagination;

    const query = `
        query($filter: String, $page: Int, $pageSize: Int) {
          ${namespace} {
            ${queryMethod}(filter: $filter, page: $page, pageSize: $pageSize) {
              items {
                ${fieldSelection}
              }
              page
              pageSize
              totalCount
            }
          }
        }
      `;

    const variables = {
      filter,
      page,
      pageSize,
    };

    const gqlBody = {
      query,
      variables,
    };

    this.logger.trace('Liferay GraphQL Request', {
      operation: 'graphql:fetchByFilter',
      namespace,
      queryMethod,
      gqlBody,
      queryForGraphiQL: `QUERY:\n${query}\n\nVARIABLES:\n${JSON.stringify(variables, null, 2)}`,
    });

    const response = await client.post('', gqlBody);

    this.logger.trace('Liferay GraphQL Response', {
      operation: 'graphql:fetchByFilter',
      namespace,
      queryMethod,
      status: response.status,
      itemCount: response.data?.data?.[namespace]?.[queryMethod]?.items?.length,
      totalCount: response.data?.data?.[namespace]?.[queryMethod]?.totalCount,
    });

    if (response.data.errors) {
      this.logger.error('GraphQL errors detected in _fetchByFilter:', {
        errors: response.data.errors,
        namespace,
        queryMethod,
        filter
      });
      throw new Error(`GraphQL query failed: ${response.data.errors[0].message}`);
    }

    if (!response.data.data || !response.data.data[namespace]) {
      this.logger.error('GraphQL response missing data for namespace:', {
        namespace,
        queryMethod,
        data: response.data.data
      });
      throw new Error(`GraphQL response missing data for ${namespace}.${queryMethod}`);
    }

    return response.data.data[namespace][queryMethod];
  }

  /**
   * Universal fetcher with Exponential Backoff
   */
  async _fetchByERCs(config, namespace, queryMethod, ercs, fields) {
    if (!Array.isArray(ercs) || ercs.length === 0) {
      throw new Error(`The "ercs" argument must be a non-empty array.`);
    }

    const client = await this._getClient(config);
    const chunks = this._chunkArray(ercs, this.maxBatchSize);
    let allResults = [];

    for (const batch of chunks) {
      const result = await this._executeWithRetry(async () => {
        const fieldSelection = fields.join(' ');
        const aliasedQueries = batch.map((erc, index) => `
          a${index}: ${queryMethod}(externalReferenceCode: "${erc}") { ${fieldSelection} }
        `).join('\n');

        const query = `query { ${namespace} { ${aliasedQueries} } }`;
        const gqlBody = { query };

        this.logger.trace('Liferay GraphQL Request (by ERCs)', {
          operation: 'graphql:fetchByERCs',
          namespace,
          queryMethod,
          ercCount: batch.length,
          gqlBody,
          queryForGraphiQL: `QUERY:\n${query}`,
        });

        const response = await client.post('', gqlBody);

        this.logger.trace('Liferay GraphQL Response (by ERCs)', {
          operation: 'graphql:fetchByERCs',
          namespace,
          queryMethod,
          status: response.status,
          data: response.data,
        });
        
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

  async _fetchByProductIds(config, namespace, queryMethod, productIds, fields) {
    if (!Array.isArray(productIds) || productIds.length === 0) return [];

    const client = await this._getClient(config);
    const chunks = this._chunkArray(productIds, this.maxBatchSize);
    let allResults = [];

    for (const batch of chunks) {
      const fieldSelection = fields.join(' ');
      const aliasedQueries = batch.map((id, index) => `
        a${index}: ${queryMethod}(id: ${id}, pageSize: 100) { items { ${fieldSelection} } }
      `).join('\n');

      const query = `query { ${namespace} { ${aliasedQueries} } }`;
      const gqlBody = { query };

      this.logger.trace(`Liferay GraphQL Request (${queryMethod})`, {
        operation: `graphql:${queryMethod}`,
        productCount: batch.length,
        gqlBody,
        queryForGraphiQL: `QUERY:\n${query}`,
      });

      const response = await client.post('', gqlBody);

      this.logger.trace(`Liferay GraphQL Response (${queryMethod})`, {
        operation: `graphql:${queryMethod}`,
        status: response.status,
        data: response.data,
      });

      if (response.data.data && response.data.data[namespace]) {
        const results = Object.values(response.data.data[namespace]);
        results.forEach(r => {
          if (r?.items) allResults = allResults.concat(r.items);
        });
      }
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

  async getProducts(config, filter, fields = ['id', 'externalReferenceCode', 'name'], pagination = { page: 1, pageSize: 200 }) {
    return this._fetchByFilter(config, 'headlessCommerceAdminCatalog_v1_0', 'products', filter, fields, pagination);
  }

  async getAccounts(config, filter, fields = ['id', 'externalReferenceCode', 'name'], pagination = { page: 1, pageSize: 200 }) {
    return this._fetchByFilter(config, 'headlessAdminUser_v1_0', 'accounts', filter, fields, pagination);
  }

  async getOrders(config, filter, fields = ['id', 'externalReferenceCode'], pagination = { page: 1, pageSize: 200 }) {
    return this._fetchByFilter(config, 'headlessCommerceAdminOrder_v1_0', 'orders', filter, fields, pagination);
  }

  async getPriceLists(config, filter, fields = ['id', 'externalReferenceCode', 'name'], pagination = { page: 1, pageSize: 200 }) {
    return this._fetchByFilter(config, 'headlessCommerceAdminPricing_v2_0', 'priceLists', filter, fields, pagination);
  }

  async getPromotions(config, filter, fields = ['id', 'externalReferenceCode', 'name'], pagination = { page: 1, pageSize: 200 }) {
    return this._fetchByFilter(config, 'headlessCommerceAdminPricing_v2_0', 'priceLists', filter, fields, pagination);
  }

  async getWarehouses(config, filter, fields = ['id', 'externalReferenceCode', 'name'], pagination = { page: 1, pageSize: 200 }) {
    return this._fetchByFilter(config, 'headlessCommerceAdminInventory_v1_0', 'warehouses', filter, fields, pagination);
  }

  async getOptions(config, filter, fields = ['id', 'key', 'externalReferenceCode'], pagination = { page: 1, pageSize: 200 }) {
    return this._fetchByFilter(config, 'headlessCommerceAdminCatalog_v1_0', 'options', filter, fields, pagination);
  }

  async getSpecifications(config, filter, fields = ['id', 'key', 'externalReferenceCode'], pagination = { page: 1, pageSize: 200 }) {
    return this._fetchByFilter(config, 'headlessCommerceAdminCatalog_v1_0', 'specifications', filter, fields, pagination);
  }

  async getSpecificationsByProductIds(config, productIds) {
    return this._fetchByProductIds(
      config, 
      'headlessCommerceAdminCatalog_v1_0', 
      'productIdProductSpecifications', 
      productIds, 
      ['specificationId', 'optionCategoryId']
    );
  }

  async getOptionsByProductIds(config, productIds) {
    return this._fetchByProductIds(
      config, 
      'headlessCommerceAdminCatalog_v1_0', 
      'productIdProductOptions', 
      productIds, 
      ['optionId']
    );
  }

  async getAccountsByERC(config, ercs, fields = ['id', 'externalReferenceCode', 'name']) {
    return this._fetchByERCs(config, 'headlessAdminUser_v1_0', 'accountByExternalReferenceCode', ercs, fields);
  }

  async getProductsByERC(config, ercs, fields = ['id', 'externalReferenceCode', 'productId']) {
    return this._fetchByERCs(config, 'headlessCommerceAdminCatalog_v1_0', 'productByExternalReferenceCode', ercs, fields);
  }

  async getWarehousesByERC(config, ercs, fields = ['id', 'externalReferenceCode', 'name']) {
    return this._fetchByERCs(config, 'headlessCommerceAdminInventory_v1_0', 'warehouseByExternalReferenceCode', ercs, fields);
  }

  async getPostalAddressesByERC(config, ercs, fields = ['id', 'externalReferenceCode']) {
    return this._fetchByERCs(config, 'headlessAdminUser_v1_0', 'postalAddressByExternalReferenceCode', ercs, fields);
  }

  _chunkArray(arr, size) {
    return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
  }
}

module.exports = LiferayGraphQLService;
