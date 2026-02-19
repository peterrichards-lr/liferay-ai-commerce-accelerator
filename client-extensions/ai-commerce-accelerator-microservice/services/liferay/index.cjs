const LiferayRestService = require('./rest.cjs');
const LiferayGraphQLService = require('./graphql.cjs');
const { asItems, asCount } = require('../../utils/liferayUtils.cjs');
const { PATH } = require('../../utils/liferayPaths.cjs');

class LiferayService {
  constructor(ctx) {
    this.ctx = ctx;
    this.rest = new LiferayRestService(ctx);
    this.graphql = new LiferayGraphQLService(ctx);
  }

  // --- Discovery Methods (Coordinating GraphQL & REST) ---

  async getCommerceProducts(
    config,
    { catalogId, pageSize = 200, fields = 'productId' } = {},
  ) {
    const exclusions = await this._getExclusions(config, 'product');

    const filters = [];
    if (catalogId) filters.push(`catalogId eq ${catalogId}`);
    
    const nameFilter = this._buildNameExclusionFilter(exclusions);
    if (nameFilter) filters.push(nameFilter);

    const filter = filters.join(' and ');

    const requestedFields = new Set(fields.split(','));
    ['productId', 'externalReferenceCode', 'name'].forEach(f => requestedFields.add(f));

    const res = await this.graphql.getProducts(config, filter, Array.from(requestedFields), {
      page: 1,
      pageSize,
    });

    const items = asItems(res);
    const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));
    
    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getCommerceAccounts(
    config,
    { channelId, pageSize = 200, fields = 'id' } = {},
  ) {
    const exclusions = await this._getExclusions(config, 'account');

    const filters = [];

    if (channelId) {
      const orderAccountIds = await this.rest._collectPagedIds(config, {
        op: 'orders:list',
        friendly: 'List account IDs from orders for channel',
        listUrl: PATH.ORDERS,
        pageSize,
        filter: `channelId eq ${channelId}`,
        fields: 'accountId',
        idKey: 'accountId',
      });

      const uniqueIds = [...new Set(orderAccountIds)].filter(Boolean);

      if (!uniqueIds.length) {
        return {
          items: [],
          page: 1,
          pageSize: 0,
          lastPage: 1,
          totalCount: 0,
        };
      }

      filters.push(`id in (${uniqueIds.join(',')})`);
    }

    const nameFilter = this._buildNameExclusionFilter(exclusions);
    if (nameFilter) filters.push(nameFilter);

    const filter = filters.join(' and ');

    const requestedFields = new Set(fields.split(','));
    ['id', 'externalReferenceCode', 'name'].forEach(f => requestedFields.add(f));

    const res = await this.graphql.getAccounts(config, filter, Array.from(requestedFields), {
      page: 1,
      pageSize,
    });

    const items = asItems(res);
    const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getCommerceOptionCategories(config, { pageSize = 200, fields = 'id' } = {}) {
    const exclusions = await this._getExclusions(config, 'optionCategory');

    const requestedFields = new Set(fields.split(','));
    ['id', 'externalReferenceCode', 'title'].forEach(f => requestedFields.add(f));

    const res = await this.rest._listOptionCategories(config, { pageSize, fields: Array.from(requestedFields).join(',') });
    const items = asItems(res);
    const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount || filteredItems.length,
    };
  }

  async getCommerceSpecifications(config, { pageSize = 200, fields = 'id' } = {}) {
    const exclusions = await this._getExclusions(config, 'specification');

    const requestedFields = new Set(fields.split(','));
    ['id', 'key', 'externalReferenceCode', 'title'].forEach(f => requestedFields.add(f));

    const res = await this.graphql.getSpecifications(config, null, Array.from(requestedFields), { page: 1, pageSize });
    const items = asItems(res);
    const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getCommerceOptions(config, { pageSize = 200, fields = 'id' } = {}) {
    const exclusions = await this._getExclusions(config, 'option');

    const requestedFields = new Set(fields.split(','));
    ['id', 'key', 'externalReferenceCode', 'name'].forEach(f => requestedFields.add(f));

    const res = await this.graphql.getOptions(config, null, Array.from(requestedFields), { page: 1, pageSize });
    const items = asItems(res);
    const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getCommerceOrders(config, { pageSize = 200, fields = 'id' } = {}) {
    const exclusions = await this._getExclusions(config, 'order');

    const requestedFields = new Set(fields.split(','));
    ['id', 'externalReferenceCode'].forEach(f => requestedFields.add(f));

    const res = await this.graphql.getOrders(config, null, Array.from(requestedFields), { page: 1, pageSize });
    const items = asItems(res);
    const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getCommerceWarehouses(config, { pageSize = 200, fields = 'id' } = {}) {
    const exclusions = await this._getExclusions(config, 'warehouse');

    const requestedFields = new Set(fields.split(','));
    ['id', 'externalReferenceCode', 'name'].forEach(f => requestedFields.add(f));

    const res = await this.graphql.getWarehouses(config, null, Array.from(requestedFields), { page: 1, pageSize });
    const items = asItems(res);
    const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getCommercePriceLists(
    config,
    { pageSize = 200, fields = 'id', type = 'PRICE_LIST' } = {},
  ) {
    const exclusions = await this._getExclusions(config, 'priceList');

    const requestedFields = new Set(fields.split(','));
    ['id', 'externalReferenceCode', 'name', 'catalogBasePriceList', 'type'].forEach(f => requestedFields.add(f));

    const filters = [`type eq '${type}'`, `catalogBasePriceList eq false` ];
    
    const nameFilter = this._buildNameExclusionFilter(exclusions);
    if (nameFilter) filters.push(nameFilter);

    const filter = filters.join(' and ');

    const res = await this.graphql.getPriceLists(config, filter, Array.from(requestedFields), { page: 1, pageSize });
    const items = asItems(res);
    const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getCommercePromotions(config, args = {}) {
    return this.getCommercePriceLists(config, { ...args, type: 'PROMOTION' });
  }

  // --- Filtered Deletion Loop ---

  async deleteByFilter(
    config,
    { entityName, filter, search, searchPrefixes, nativeBatch, ids: providedIds, items: providedItems, channelId, ...rest },
  ) {
    const { logger } = this.ctx;

    const exclusions = await this._getExclusions(config, entityName);
    
    const discoveryFields = new Set(['id', 'productId', 'externalReferenceCode', 'name', 'title']);
    if (entityName === 'priceList' || entityName === 'promotion') discoveryFields.add('catalogBasePriceList');
    const fieldsParam = Array.from(discoveryFields).join(',');

    let totalDeleted = 0;
    const batchRefs = [];

    const processBatch = async (items) => {
      const filteredItems = items.filter(it => !this._shouldExclude(it, exclusions));
      
      const ids = filteredItems
        .map(it => entityName === 'product' ? (it.productId || it.id) : (it.id || it.productId))
        .filter(Boolean);

      if (ids.length === 0) return;

      let result;
      if (nativeBatch) {
        result = await this.rest._deleteBatchNative(config, {
          entityName,
          ids,
          idField: entityName === 'product' ? 'productId' : 'id',
          ...rest,
        });
      } else {
        result = await this.rest._deleteBatchSimulated(config, {
          entityName,
          ids,
          ...rest,
        });
      }

      totalDeleted += (result.count || 0);
      if (result.batchRefs) batchRefs.push(...result.batchRefs);
    };

    if (providedItems && providedItems.length > 0) {
      const chunks = this.rest._chunkArray(providedItems, 500);
      for (const chunk of chunks) {
        await processBatch(chunk);
      }
    } else if (providedIds && providedIds.length > 0) {
      const idChunks = this.rest._chunkArray(providedIds, 200);
      for (const idChunk of idChunks) {
        const idFilter = entityName === 'product' 
          ? `productId in (${idChunk.join(',')})`
          : `id in (${idChunk.join(',')})`;
        
        const items = await this.rest._collectPagedItems(config, {
          listUrl: rest.listUrl,
          pageSize: 200,
          filter: idFilter,
          fields: fieldsParam,
          op: `${entityName}:list-for-exclusion`,
          friendly: `Fetch ${entityName} for metadata check`,
        });
        await processBatch(items);
      }
    } else {
      let page = 1;
      let hasMore = true;
      const pageSize = 200;

      while (hasMore) {
        let res;
        if (entityName === 'account') {
          res = await this.getCommerceAccounts(config, { channelId, pageSize, fields: fieldsParam });
        } else if (entityName === 'priceList') {
          res = await this.getCommercePriceLists(config, { pageSize, fields: fieldsParam });
        } else if (entityName === 'promotion') {
          res = await this.getCommercePromotions(config, { pageSize, fields: fieldsParam });
        } else if (entityName === 'product') {
          res = await this.getCommerceProducts(config, { catalogId: rest.catalogId, pageSize, fields: fieldsParam });
        } else {
          res = await this.rest._get(config, rest.listUrl, `${entityName}:list`, `List ${entityName}`, {
            params: {
              page,
              pageSize,
              filter,
              search,
              fields: fieldsParam,
            },
          });
        }

        const items = asItems(res);
        if (items.length === 0) {
          hasMore = false;
          break;
        }

        await processBatch(items);

        if (items.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }

        if (page > 1000) {
           logger.warn('Safety break hit in deleteByFilter pagination', { entityName, sessionId: rest.sessionId });
           break;
        }
      }
    }

    return { success: true, count: totalDeleted, batchRefs };
  }

  async deletePriceListsBatch(
    config,
    {
      pageSize = 200,
      filter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {},
  ) {
    return this.deleteByFilter(config, {
      entityName: 'priceList',
      filter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.PRICE_LISTS_BATCH,
      listUrl: PATH.PRICE_LISTS,
      op: 'pricelists:batch-delete',
      friendly: 'Delete price lists (batch)',
      items,
    });
  }

  async deletePromotionsBatch(
    config,
    {
      pageSize = 200,
      filter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {},
  ) {
    return this.deleteByFilter(config, {
      entityName: 'promotion',
      filter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.PRICE_LISTS_BATCH,
      listUrl: PATH.PRICE_LISTS,
      op: 'promotions:batch-delete',
      friendly: 'Delete promotions (batch)',
      items,
    });
  }

  async deleteSpecificationsBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {},
  ) {
    return this.deleteByFilter(config, {
      entityName: 'specification',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.SPECIFICATIONS_BATCH,
      listUrl: PATH.SPECIFICATIONS,
      op: 'specifications:batch-delete',
      friendly: 'Delete specifications (batch)',
      items,
    });
  }

  async deleteOptionsBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {},
  ) {
    return this.deleteByFilter(config, {
      entityName: 'option',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.OPTIONS_BATCH,
      listUrl: PATH.OPTIONS,
      op: 'options:batch-delete',
      friendly: 'Delete options (batch)',
      items,
    });
  }

  async deleteOptionCategoriesBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {},
  ) {
    return this.deleteByFilter(config, {
      entityName: 'optionCategory',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.OPTION_CATEGORIES_BATCH,
      listUrl: PATH.OPTION_CATEGORIES,
      op: 'optionCategories:batch-delete',
      friendly: 'Delete option categories (batch)',
      items,
    });
  }

  // --- Exclusion Helpers ---

  _buildNameExclusionFilter(exclusions, fieldName = 'name') {
    if (!exclusions || exclusions.length === 0) return null;
    const names = exclusions
      .map((ex) => ex.name)
      .filter((n) => n && typeof n === 'string');
    if (names.length === 0) return null;
    return names.map((name) => `${fieldName} ne '${name}'`).join(' and ');
  }

  async _getExclusions(config, entityName) {
    const { config: configService } = this.ctx;
    const excludeLists = await configService.getExcludeLists(config);
    
    const keyMap = {
      account: 'excludedAccounts',
      product: 'excludedProducts',
      warehouse: 'excludedWarehouses',
      priceList: 'excludedPriceLists',
      promotion: 'excludedPriceLists', // Promotions are in the PriceLists exclude list
      order: 'excludedOrders',
      specification: 'excludedSpecifications',
      option: 'excludedOptions',
      optionCategory: 'excludedOptionCategories',
    };

    const configKey = keyMap[entityName];
    return excludeLists?.[configKey] || [];
  }

  _shouldExclude(item, exclusions) {
    if (item.system === true || item.system === 'true') return true;
    if (item.catalogBasePriceList === true || item.catalogBasePriceList === 'true') return true;
    
    if (!exclusions || exclusions.length === 0) return false;

    return exclusions.some((ex) => {
      const idMatch = ex.entityId && (String(item.id) === String(ex.entityId) || String(item.productId) === String(ex.entityId));
      const ercMatch = ex.erc && item.externalReferenceCode === ex.erc;
      const nameMatch = ex.name && (item.name === ex.name || item.title === ex.name || (typeof item.name === 'object' && Object.values(item.name).includes(ex.name)));
      
      return idMatch || ercMatch || nameMatch;
    });
  }

  // --- Delegated REST Methods ---

  testConnection(config) {
    return this.rest.testConnection(config);
  }

  getConfig(config, configKey) {
    return this.rest.getConfig(config, configKey);
  }

  getCatalogs(config) {
    return this.rest.getCatalogs(config);
  }

  getCatalog(config, catalogId) {
    return this.rest.getCatalog(config, catalogId);
  }

  getChannels(config) {
    return this.rest.getChannels(config);
  }

  getProductCount(config) {
    return this.rest.getProductCount(config);
  }

  getPrimaryAccountId(config) {
    return this.rest.getPrimaryAccountId(config);
  }

  getAccountCount(config) {
    return this.rest.getAccountCount(config);
  }

  getImportTask(config, batchId) {
    return this.rest.getImportTask(config, batchId);
  }

  getImportTaskSubmittedContent(config, batchId) {
    return this.rest.getImportTaskSubmittedContent(config, batchId);
  }
  
  getImportTaskFailedItemReport(config, batchId) {
    return this.rest.getImportTaskFailedItemReport(config, batchId);
  }

  deleteAll(config, args) {
    return this.deleteByFilter(config, { ...args, filter: undefined });
  }

  createWarehouse(config, warehouseData) {
    return this.rest.createWarehouse(config, warehouseData);
  }

  createWarehousesBatch(config, warehousesData, opts) {
    return this.rest.createWarehousesBatch(config, warehousesData, opts);
  }

  deleteWarehouse(config, warehouseId) {
    return this.rest.deleteWarehouse(config, warehouseId);
  }

  updateProductInventory(config, warehouseId, sku, inventoryData) {
    return this.rest.updateProductInventory(config, warehouseId, sku, inventoryData);
  }

  getCurrencies(config) {
    return this.rest.getCurrencies(config);
  }

  getSiteLanguages(config, siteGroupId) {
    return this.rest.getSiteLanguages(config, siteGroupId);
  }

  createProduct(config, productData) {
    return this.rest.createProduct(config, productData);
  }

  createProductsBatch(config, productsData, opts) {
    return this.rest.createProductsBatch(config, productsData, opts);
  }

  createAccount(config, accountData) {
    return this.rest.createAccount(config, accountData);
  }

  patchAccount(config, accountId, accountData) {
    return this.rest.patchAccount(config, accountId, accountData);
  }

  getAccountByERC(config, externalReferenceCode) {
    return this.rest.getAccountByERC(config, externalReferenceCode);
  }

  getPostalAddressByERC(config, externalReferenceCode) {
    return this.rest.getPostalAddressByERC(config, externalReferenceCode);
  }

  getCountries(config) {
    return this.rest.getCountries(config);
  }

  getCountryRegions(config, countryId) {
    return this.rest.getCountryRegions(config, countryId);
  }

  createAccountAddress(config, accountId, addressData) {
    return this.rest.createAccountAddress(config, accountId, addressData);
  }

  createAccountAddressBatch(config, accountId, addressesData, opts) {
    return this.rest.createAccountAddressBatch(config, accountId, addressesData, opts);
  }

  createAccountsBatch(config, accountsData, opts) {
    return this.rest.createAccountsBatch(config, accountsData, opts);
  }

  createOrdersBatch(config, ordersData, opts) {
    return this.rest.createOrdersBatch(config, ordersData, opts);
  }

  createOrder(config, orderData) {
    return this.rest.createOrder(config, orderData);
  }

  createPriceList(config, priceListData) {
    return this.rest.createPriceList(config, priceListData);
  }

  createPriceEntry(config, priceListId, priceEntryData) {
    return this.rest.createPriceEntry(config, priceListId, priceEntryData);
  }

  createSkuPriceEntry(config, priceListId, skuId, priceEntryData) {
    return this.rest.createSkuPriceEntry(config, priceListId, skuId, priceEntryData);
  }

  createProductSku(config, productId, skuData) {
    return this.rest.createProductSku(config, productId, skuData);
  }

  addProductImage(config, productId, image) {
    return this.rest.addProductImage(config, productId, image);
  }

  addProductDocumentAttachment(config, productId, attachment) {
    return this.rest.addProductDocumentAttachment(config, productId, attachment);
  }

  addProductOptions(config, productId, productOptions) {
    return this.rest.addProductOptions(config, productId, productOptions);
  }

  deleteProductOption(config, productId, productOptionId) {
    return this.rest.deleteProductOption(config, productId, productOptionId);
  }

  getCommerceProductOptions(config, productId) {
    return this.rest.getCommerceProductOptions(config, productId);
  }

  deleteProductSpecification(config, productId, productSpecificationId) {
    return this.rest.deleteProductSpecification(config, productId, productSpecificationId);
  }

  getCommerceProductSpecifications(config, productId) {
    return this.rest.getCommerceProductSpecifications(config, productId);
  }

  createOption(config, optionData) {
    return this.rest.createOption(config, optionData);
  }

  createOptionWithReuse(config, optionData) {
    return this.rest.createOptionWithReuse(config, optionData);
  }

  updateOptionById(config, id, payload) {
    return this.rest.updateOptionById(config, id, payload);
  }

  createOptionValue(config, optionId, optionValueData) {
    return this.rest.createOptionValue(config, optionId, optionValueData);
  }

  getOptionByERC(config, externalReferenceCode) {
    return this.rest.getOptionByERC(config, externalReferenceCode);
  }

  getOptionByKey(config, key) {
    return this.rest.getOptionByKey(config, key);
  }

  getOptionValueByERC(config, optionId, externalReferenceCode) {
    return this.rest.getOptionValueByERC(config, optionId, externalReferenceCode);
  }

  getOptionValueByKey(config, optionId, key) {
    return this.rest.getOptionValueByKey(config, optionId, key);
  }
  
  updateOptionValueById(config, optionId, valueId, payload) {
    return this.rest.updateOptionValueById(config, optionId, valueId, payload);
  }

  updateOptionValueByERC(config, optionId, externalReferenceCode, payload) {
    return this.rest.updateOptionValueByERC(config, optionId, externalReferenceCode, payload);
  }

  createOptionValueWithReuse(config, optionId, payload) {
    return this.rest.createOptionValueWithReuse(config, optionId, payload);
  }

  createOptionCategory(config, optionCategoryData) {
    return this.rest.createOptionCategory(config, optionCategoryData);
  }

  getOptionCategoryByKey(config, key) {
    return this.rest.getOptionCategoryByKey(config, key);
  }

  updateOptionCategoryById(config, id, payload) {
    return this.rest.updateOptionCategoryById(config, id, payload);
  }

  createOptionCategoryWithReuse(config, payload) {
    return this.rest.createOptionCategoryWithReuse(config, payload);
  }
  
  getOptionCategoryByERC(config, externalReferenceCode) {
    return this.rest.getOptionCategoryByERC(config, externalReferenceCode);
  }

  updateSpecificationById(config, id, payload) {
    return this.rest.updateSpecificationById(config, id, payload);
  }

  getSpecificationByKey(config, key) {
    return this.rest.getSpecificationByKey(config, key);
  }

  createSpecificationWithReuse(config, payload) {
    return this.rest.createSpecificationWithReuse(config, payload);
  }

  setBillingAndShippingAddresses(config, accountId, shippingAddressId, billingAddressId) {
    return this.rest.setBillingAndShippingAddresses(config, accountId, shippingAddressId, billingAddressId);
  }

  // Delegated GraphQL Methods
  getProducts(config, filter, fields, pagination) {
    return this.graphql.getProducts(config, filter, fields, pagination);
  }

  getAccounts(config, filter, fields, pagination) {
    return this.graphql.getAccounts(config, filter, fields, pagination);
  }

  getOrders(config, filter, fields, pagination) {
    return this.graphql.getOrders(config, filter, fields, pagination);
  }

  getPriceLists(config, filter, fields, pagination) {
    return this.graphql.getPriceLists(config, filter, fields, pagination);
  }

  getWarehouses(config, filter, fields, pagination) {
    return this.graphql.getWarehouses(config, filter, fields, pagination);
  }

  getOptions(config, filter, fields, pagination) {
    return this.graphql.getOptions(config, filter, fields, pagination);
  }

  getSpecifications(config, filter, fields, pagination) {
    return this.graphql.getSpecifications(config, filter, fields, pagination);
  }

  getSpecificationsByProductIds(config, productIds, fields) {
    return this.graphql.getSpecificationsByProductIds(config, productIds, fields);
  }

  getOptionsByProductIds(config, productIds, fields) {
    return this.graphql.getOptionsByProductIds(config, productIds, fields);
  }

  getAccountsByERC(config, ercs, fields) {
    return this.graphql.getAccountsByERC(config, ercs, fields);
  }

  getProductsByERC(config, ercs, fields) {
    return this.graphql.getProductsByERC(config, ercs, fields);
  }

  getPostalAddressesByERC(config, ercs, fields) {
    return this.graphql.getPostalAddressesByERC(config, ercs, fields);
  }
}

module.exports = { LiferayService };
