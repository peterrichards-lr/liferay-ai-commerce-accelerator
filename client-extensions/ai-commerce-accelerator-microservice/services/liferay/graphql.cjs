const axios = require('axios');

class LiferayGraphQLService {
  constructor(ctx) {
    this.ctx = ctx;
    this.maxBatchSize = 50;
    this.maxRetries = 10;
    this.initialDelay = 2000;
  }

  async _getClient(config) {
    const accessToken = await this.ctx.oauth.getAccessToken(
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

  /**
   * Universal fetcher for ERC-based lookups.
   * Consolidates all specific entity lookups into one manageable pattern.
   */
  async fetchEntitiesByERC(config, namespace, method, ercs, fields) {
    if (!ercs || ercs.length === 0) return [];

    const results = await this._fetchByERCs(
      config,
      namespace,
      method,
      ercs,
      fields
    );

    // The Magic: Object.values turns the aliased object {alias0: {}, alias1: {}}
    // into a flat array [{}, {}], effectively hiding GraphQL implementation details.
    return Object.values(results).filter(Boolean);
  }

  async _fetchByERCs(config, namespace, method, ercs, fields) {
    const client = await this._getClient(config);
    const fieldSelection = fields.join(' ');

    // Chunk requests to avoid hitting GraphQL complexity limits
    const chunks = [];
    for (let i = 0; i < ercs.length; i += this.maxBatchSize) {
      chunks.push(ercs.slice(i, i + this.maxBatchSize));
    }

    let combinedResults = {};

    for (const chunk of chunks) {
      const queryParts = chunk.map((erc, index) => {
        return `alias${index}: ${method}(externalReferenceCode: "${erc}") { ${fieldSelection} }`;
      });

      const query = `
        query {
          ${namespace} {
            ${queryParts.join('\n')}
          }
        }
      `;

      try {
        const response = await client.post('', { query });
        if (response.data.errors) {
          throw new Error(
            `GraphQL Errors: ${JSON.stringify(response.data.errors)}`
          );
        }
        // Merge this chunk's results into the master object
        Object.assign(combinedResults, response.data.data[namespace]);
      } catch (error) {
        this.ctx.logger.error(`GraphQL fetch failed for ${method}`, {
          error: error.message,
        });
        throw error;
      }
    }

    return combinedResults;
  }

  // --- Unified Collection Fetcher ---

  async _fetchCollection(config, namespace, queryMethod, fields, pagination = { page: 1, pageSize: 200 }, filter = null) {
    const client = await this._getClient(config);
    const fieldSelection = fields.join(' ');
    const filterArg = filter ? `, filter: "${filter}"` : '';
    const { page = 1, pageSize = 200 } = pagination;
    
    const query = `
      query {
        ${namespace} {
          ${queryMethod}(page: ${page}, pageSize: ${pageSize}${filterArg}) {
            items {
              ${fieldSelection}
            }
            totalCount
          }
        }
      }
    `;

    try {
      const response = await client.post('', { query });
      if (response.data.errors) {
        throw new Error(`GraphQL Errors in ${queryMethod}: ${JSON.stringify(response.data.errors)}`);
      }
      return response.data.data[namespace][queryMethod];
    } catch (error) {
      this.ctx.logger.error(`GraphQL _fetchCollection failed for ${queryMethod}`, { 
        error: error.message,
        namespace,
        queryMethod 
      });
      throw error;
    }
  }

  // --- Collection Methods (Thin Wrappers) ---

  async getCatalogs(config) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'catalogs',
      ['id', 'externalReferenceCode', 'name', 'defaultLanguageId', 'currencyCode']
    );
  }

  async getChannels(config) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminChannel_v1_0',
      'channels',
      ['id', 'externalReferenceCode', 'name', 'siteGroupId', 'currencyCode']
    );
  }

  async getCountries(config) {
    return this._fetchCollection(
      config,
      'headlessAdminAddress_v1_0',
      'countries',
      ['id', 'a2', 'name', 'title_i18n']
    );
  }

  async getLanguages(config, siteKey) {
    const client = await this._getClient(config);
    const query = `
      query {
        headlessDelivery_v1_0 {
          languages(siteKey: "${siteKey}") {
            items {
              id
              name
              markedAsDefault
            }
            totalCount
          }
        }
      }
    `;

    try {
      const response = await client.post('', { query });
      if (response.data.errors) throw new Error(JSON.stringify(response.data.errors));
      return response.data.data.headlessDelivery_v1_0.languages;
    } catch (error) {
      this.ctx.logger.error(`GraphQL getLanguages failed for site ${siteKey}`, { error: error.message });
      throw error;
    }
  }

  async getCountryRegions(config, countryId) {
    const client = await this._getClient(config);
    const query = `
      query {
        headlessAdminAddress_v1_0 {
          countryRegions(countryId: ${countryId}) {
            items {
              id
              name
            }
            totalCount
          }
        }
      }
    `;

    try {
      const response = await client.post('', { query });
      if (response.data.errors) throw new Error(JSON.stringify(response.data.errors));
      return response.data.data.headlessAdminAddress_v1_0.countryRegions;
    } catch (error) {
      this.ctx.logger.error(`GraphQL getCountryRegions failed for ${countryId}`, { error: error.message });
      throw error;
    }
  }

  async getWarehouses(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessCommerceAdminInventory_v1_0', 'warehouses', fields, opts, filter);
  }

  async getProducts(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessCommerceAdminCatalog_v1_0', 'products', fields, opts, filter);
  }

  async getAccounts(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessAdminUser_v1_0', 'accounts', fields, opts, filter);
  }

  async getOrders(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessCommerceAdminOrder_v1_0', 'orders', fields, opts, filter);
  }

  async getOptions(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessCommerceAdminCatalog_v1_0', 'options', fields, opts, filter);
  }

  async getOptionCategories(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessCommerceAdminCatalog_v1_0', 'optionCategories', fields, opts, filter);
  }

  async getSpecifications(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessCommerceAdminCatalog_v1_0', 'specifications', fields, opts, filter);
  }

  async getPriceLists(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessCommerceAdminPricing_v2_0', 'priceLists', fields, opts, filter);
  }

  async getDiscounts(config, filter, fields, opts) {
    return this._fetchCollection(config, 'headlessCommerceAdminPricing_v2_0', 'discounts', fields, opts, filter);
  }

  async getWarehouseItems(config, warehouseId, filter, fields, opts) {
    const client = await this._getClient(config);
    const fieldSelection = fields.join(' ');
    const filterArg = filter ? `, filter: "${filter}"` : '';
    const { page = 1, pageSize = 200 } = opts || {};

    const query = `
      query {
        headlessCommerceAdminInventory_v1_0 {
          warehouseIdWarehouseItems(id: ${warehouseId}, page: ${page}, pageSize: ${pageSize}${filterArg}) {
            items {
              ${fieldSelection}
            }
            totalCount
          }
        }
      }
    `;

    try {
      const response = await client.post('', { query });
      if (response.data.errors) throw new Error(JSON.stringify(response.data.errors));
      return response.data.data.headlessCommerceAdminInventory_v1_0.warehouseIdWarehouseItems;
    } catch (error) {
      this.ctx.logger.error(`GraphQL getWarehouseItems failed for warehouse ${warehouseId}`, { error: error.message });
      throw error;
    }
  }

  // --- Specific Entity Methods (Now just thin wrappers) ---

  async getAccountsByERC(
    config,
    ercs,
    fields = ['id', 'externalReferenceCode', 'name']
  ) {
    return this.fetchEntitiesByERC(
      config,
      'headlessAdminUser_v1_0',
      'accountByExternalReferenceCode',
      ercs,
      fields
    );
  }

  async getProductsByERC(
    config,
    ercs,
    fields = ['id', 'externalReferenceCode', 'productId']
  ) {
    return this.fetchEntitiesByERC(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'productByExternalReferenceCode',
      ercs,
      fields
    );
  }

  async getWarehousesByERC(
    config,
    ercs,
    fields = ['id', 'externalReferenceCode', 'name']
  ) {
    return this.fetchEntitiesByERC(
      config,
      'headlessCommerceAdminInventory_v1_0',
      'warehouseByExternalReferenceCode',
      ercs,
      fields
    );
  }

  async getSkusByERC(
    config,
    ercs,
    fields = ['id', 'externalReferenceCode', 'sku']
  ) {
    return this.fetchEntitiesByERC(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'skuByExternalReferenceCode',
      ercs,
      fields
    );
  }

  async getPostalAddressesByERC(
    config,
    ercs,
    fields = ['id', 'externalReferenceCode']
  ) {
    return this.fetchEntitiesByERC(
      config,
      'headlessAdminAddress_v1_0',
      'postalAddressByExternalReferenceCode',
      ercs,
      fields
    );
  }
}

module.exports = LiferayGraphQLService;
