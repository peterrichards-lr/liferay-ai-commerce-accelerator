const LiferayRestService = require('./rest.cjs');
const LiferayGraphQLService = require('./graphql.cjs');

class LiferayService {
  constructor(ctx) {
    this.rest = new LiferayRestService(ctx);
    this.graphql = new LiferayGraphQLService(ctx);
    
    // Pass the graphql service to the rest service for existing integrations
    this.rest.liferayGraphQL = this.graphql;
  }

  // Delegated methods from LiferayRestService
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

  getCommerceProducts(config, args) {
    return this.rest.getCommerceProducts(config, args);
  }

  getCommerceAccounts(config, args) {
    return this.rest.getCommerceAccounts(config, args);
  }
  
  getOptionCategories(config, args) {
    return this.rest.getOptionCategories(config, args);
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

  deleteByFilter(config, args) {
    return this.rest.deleteByFilter(config, args);
  }

  deleteAll(config, args) {
    return this.rest.deleteAll(config, args);
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

  deletePriceListsBatch(config, args) {
    return this.rest.deletePriceListsBatch(config, args);
  }

  deleteSpecificationsBatch(config, args) {
    return this.rest.deleteSpecificationsBatch(config, args);
  }

  deleteOptionsBatch(config, args) {
    return this.rest.deleteOptionsBatch(config, args);
  }

  deleteOptionCategoriesBatch(config, args) {
    return this.rest.deleteOptionCategoriesBatch(config, args);
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

  // Delegated methods from LiferayGraphQLService
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

  getPostalAddressesByERC(config, ercs, fields) {
    return this.graphql.getPostalAddressesByERC(config, ercs, fields);
  }
}

module.exports = { LiferayService };
