const axios = require('axios');

class LiferayGraphQLService {
  constructor(ctx) {
    this.ctx = ctx;
    this.maxBatchSize = 50;
    this.maxRetries = 10;
    this.initialDelay = 2000;
  }

  async _getClient(config) {
    const { oauth } = this.ctx;
    const { ENV } = require('../utils/constants.cjs');
    let authHeader;

    // HARDENING: Fallback to Basic Auth if OAuth is not configured or specifically requested
    const useBasic =
      config.authMethod === 'basic' ||
      (!config.clientId &&
        ENV.LIFERAY_API_USERNAME &&
        ENV.LIFERAY_API_PASSWORD);

    if (useBasic) {
      const user = config.username || ENV.LIFERAY_API_USERNAME;
      const pass = config.password || ENV.LIFERAY_API_PASSWORD;
      const token = Buffer.from(`${user}:${pass}`).toString('base64');
      authHeader = `Basic ${token}`;
    } else {
      const accessToken = await oauth.getAccessToken(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
      authHeader = `Bearer ${accessToken}`;
    }

    return axios.create({
      baseURL: `${config.liferayUrl}/o/graphql`,
      timeout: 30000,
      headers: {
        Authorization: authHeader,
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
    let globalIndex = 0;

    for (const chunk of chunks) {
      const queryParts = chunk.map((erc) => {
        return `alias${globalIndex++}: ${method}(externalReferenceCode: "${erc}") { ${fieldSelection} }`;
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
          this.ctx.logger.warn(`GraphQL partial failure in ${method}`, {
            errorCount: response.data.errors.length,
            firstError: response.data.errors[0].message,
          });
        }
        // Merge successful aliases from this chunk
        if (response.data.data && response.data.data[namespace]) {
          Object.assign(combinedResults, response.data.data[namespace]);
        }
      } catch (error) {
        this.ctx.logger.warn(`GraphQL fetch failed for ${method}`, {
          error: error.message,
        });
        throw error;
      }
    }

    return combinedResults;
  }

  // --- Unified Collection Fetcher ---

  async _fetchCollection(
    config,
    namespace,
    queryMethod,
    fields,
    pagination = { page: 1, pageSize: 200 },
    filter = null,
    search = null
  ) {
    const client = await this._getClient(config);
    const fieldSelection = fields.join(' ');

    // Safety: ensure filter is a string and properly escaped for the GraphQL query string
    const safeFilter = typeof filter === 'string' ? filter : '';
    const escapedFilter = safeFilter
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    const filterArg = escapedFilter ? `, filter: "${escapedFilter}"` : '';

    // Search support
    const safeSearch = typeof search === 'string' ? search : '';
    const escapedSearch = safeSearch
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    const searchArg = escapedSearch ? `, search: "${escapedSearch}"` : '';

    let allItems = [];
    let currentPage = pagination.page || 1;
    const pageSize = pagination.pageSize || 200;
    let hasMore = true;
    let totalCount = 0;

    while (hasMore) {
      const query = `
        query {
          ${namespace} {
            ${queryMethod}(page: ${currentPage}, pageSize: ${pageSize}${filterArg}${searchArg}) {
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
          response.data.errors.forEach((err) => {
            this.ctx.logger.warn(
              `GraphQL Error in ${queryMethod}: ${err.message}`,
              {
                path: err.path,
                namespace,
                queryMethod,
              }
            );
          });
          throw new Error(
            `GraphQL Errors in ${queryMethod}: ${response.data.errors[0].message}`
          );
        }

        const result = response.data.data[namespace][queryMethod];
        const items = result.items || [];
        totalCount = result.totalCount || 0;

        allItems.push(...items);

        if (items.length < pageSize || allItems.length >= totalCount) {
          hasMore = false;
        } else {
          currentPage++;
        }

        // Safety break
        if (currentPage > 1000) break;
      } catch (error) {
        this.ctx.logger.warn(
          `GraphQL _fetchCollection failed for ${queryMethod}`,
          {
            error: error.message,
            namespace,
            queryMethod,
          }
        );
        throw error;
      }
    }

    return {
      items: allItems,
      totalCount: totalCount,
    };
  }

  // --- Collection Methods (Thin Wrappers) ---

  async getCurrencies(config) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'currencies',
      ['id', 'externalReferenceCode', 'code', 'name', 'active']
    );
  }

  async getTaxonomyVocabularies(config, siteKey) {
    return this._fetchCollection(
      config,
      'headlessAdminTaxonomy_v1_0',
      'taxonomyVocabularies',
      ['id', 'externalReferenceCode', 'name', 'description'],
      { page: 1, pageSize: 200 },
      `siteKey eq '${siteKey}'`
    );
  }

  async getTaxonomyCategories(config, vocabularyId) {
    const client = await this._getClient(config);
    const query = `
      query {
        headlessAdminTaxonomy_v1_0 {
          taxonomyVocabularyTaxonomyCategories(taxonomyVocabularyId: ${vocabularyId}, flatten: true, pageSize: 500) {
            items {
              id
              externalReferenceCode
              name
              description
            }
            totalCount
          }
        }
      }
    `;

    try {
      const response = await client.post('', { query });
      if (response.data.errors)
        throw new Error(JSON.stringify(response.data.errors));
      return response.data.data.headlessAdminTaxonomy_v1_0
        .taxonomyVocabularyTaxonomyCategories;
    } catch (error) {
      this.ctx.logger.warn(
        `GraphQL getTaxonomyCategories failed for vocabulary ${vocabularyId}`,
        { error: error.message }
      );
      throw error;
    }
  }

  async getCatalogs(config) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'catalogs',
      [
        'id',
        'externalReferenceCode',
        'name',
        'defaultLanguageId',
        'currencyCode',
      ]
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
      ['id', 'a2', 'a3', 'name', 'active', 'title_i18n']
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
      if (response.data.errors)
        throw new Error(JSON.stringify(response.data.errors));
      return response.data.data.headlessDelivery_v1_0.languages;
    } catch (error) {
      this.ctx.logger.warn(`GraphQL getLanguages failed for site ${siteKey}`, {
        error: error.message,
      });
      throw error;
    }
  }

  async getSiteLanguages(config, siteKey) {
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
      if (response.data.errors)
        throw new Error(JSON.stringify(response.data.errors));
      return response.data.data.headlessDelivery_v1_0.languages;
    } catch (error) {
      this.ctx.logger.warn(
        `GraphQL getSiteLanguages failed for site ${siteKey}`,
        { error: error.message }
      );
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
              regionCode
              title_i18n
            }
            totalCount
          }
        }
      }
    `;

    try {
      const response = await client.post('', { query });
      if (response.data.errors)
        throw new Error(JSON.stringify(response.data.errors));
      return response.data.data.headlessAdminAddress_v1_0.countryRegions;
    } catch (error) {
      this.ctx.logger.warn(
        `GraphQL getCountryRegions failed for ${countryId}`,
        { error: error.message }
      );
      throw error;
    }
  }

  async getWarehouses(config, filter, fields, opts, search = null) {
    // Simplify warehouses discovery fields
    const discoveryFields = fields || ['id', 'externalReferenceCode', 'name'];
    return this._fetchCollection(
      config,
      'headlessCommerceAdminInventory_v1_0',
      'warehouses',
      discoveryFields,
      opts,
      filter,
      search
    );
  }

  async getProducts(config, filter, fields, opts, search = null) {
    // Ensure id and externalReferenceCode are always requested
    const requestedFields = new Set(
      fields || ['id', 'externalReferenceCode', 'productId', 'name']
    );
    requestedFields.add('id');
    requestedFields.add('externalReferenceCode');

    return this._fetchCollection(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'products',
      Array.from(requestedFields),
      opts,
      filter,
      search
    );
  }

  async getAccounts(config, filter, fields, opts, search = null) {
    const discoveryFields = fields || ['id', 'externalReferenceCode', 'name'];
    return this._fetchCollection(
      config,
      'headlessAdminUser_v1_0',
      'accounts',
      discoveryFields,
      opts,
      filter,
      search
    );
  }

  async getOrders(config, filter, fields, opts, search = null) {
    // Simplify orders discovery fields
    const discoveryFields = fields || [
      'id',
      'externalReferenceCode',
      'orderNumber',
    ];
    return this._fetchCollection(
      config,
      'headlessCommerceAdminOrder_v1_0',
      'orders',
      discoveryFields,
      opts,
      filter,
      search
    );
  }

  async getOptions(config, filter, fields, opts) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'options',
      fields,
      opts,
      filter
    );
  }

  async getOptionCategories(config, filter, fields, opts) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'optionCategories',
      fields,
      opts,
      filter
    );
  }

  async getSpecifications(config, filter, fields, opts) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminCatalog_v1_0',
      'specifications',
      fields,
      opts,
      filter
    );
  }

  async getPriceLists(config, filter, fields, opts) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminPricing_v2_0',
      'priceLists',
      fields,
      opts,
      filter
    );
  }

  async getDiscounts(config, filter, fields, opts) {
    return this._fetchCollection(
      config,
      'headlessCommerceAdminPricing_v2_0',
      'discounts',
      fields,
      opts,
      filter
    );
  }

  async getWarehouseItems(config, warehouseId, filter, fields, opts) {
    const client = await this._getClient(config);
    const fieldSelection = fields.join(' ');
    const safeFilter = typeof filter === 'string' ? filter : '';
    const escapedFilter = safeFilter
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    const filterArg = escapedFilter ? `, filter: "${escapedFilter}"` : '';
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
      if (response.data.errors)
        throw new Error(response.data.errors[0].message);
      return response.data.data.headlessCommerceAdminInventory_v1_0
        .warehouseIdWarehouseItems;
    } catch (error) {
      this.ctx.logger.warn(
        `GraphQL getWarehouseItems failed for warehouse ${warehouseId}`,
        { error: error.message }
      );
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

  async getOptionsByProductIds(
    config,
    productIds,
    fields = ['id', 'optionId', 'optionExternalReferenceCode', 'name']
  ) {
    if (!productIds || productIds.length === 0) return [];

    const client = await this._getClient(config);
    const fieldSelection = fields.join('\n                ');

    // Use Aliased Queries for 100% reliability fetching multiple IDs
    const queries = productIds
      .map(
        (id, index) => `
      p${index}: product(id: ${id}) {
        productOptions {
          ${fieldSelection}
        }
      }
    `
      )
      .join('\n');

    const query = `
      query {
        headlessCommerceAdminCatalog_v1_0 {
          ${queries}
        }
      }
    `;

    try {
      const response = await client.post('', { query });
      if (response.data.errors)
        throw new Error(JSON.stringify(response.data.errors));

      const results = response.data.data.headlessCommerceAdminCatalog_v1_0;
      return Object.values(results).flatMap((p) => p?.productOptions || []);
    } catch (error) {
      this.ctx.logger.warn(`GraphQL getOptionsByProductIds failed`, {
        error: error.message,
      });
      throw error;
    }
  }

  async getSpecificationsByProductIds(
    config,
    productIds,
    fields = ['id', 'externalReferenceCode', 'specificationKey']
  ) {
    if (!productIds || productIds.length === 0) return [];

    const client = await this._getClient(config);
    const fieldSelection = fields.join('\n                ');

    const queries = productIds
      .map(
        (id, index) => `
      p${index}: product(id: ${id}) {
        productSpecifications {
          ${fieldSelection}
        }
      }
    `
      )
      .join('\n');

    const query = `
      query {
        headlessCommerceAdminCatalog_v1_0 {
          ${queries}
        }
      }
    `;

    try {
      const response = await client.post('', { query });
      if (response.data.errors)
        throw new Error(JSON.stringify(response.data.errors));

      const results = response.data.data.headlessCommerceAdminCatalog_v1_0;
      return Object.values(results).flatMap(
        (p) => p?.productSpecifications || []
      );
    } catch (error) {
      this.ctx.logger.warn(`GraphQL getSpecificationsByProductIds failed`, {
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = LiferayGraphQLService;
