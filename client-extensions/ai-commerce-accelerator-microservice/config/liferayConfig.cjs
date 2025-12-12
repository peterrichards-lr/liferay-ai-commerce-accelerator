const { ENV } = require('../utils/constants.cjs');

module.exports = {
  endpoints: {
    catalogs: '/o/headless-commerce-admin-catalog/v1.0/catalogs',
    products: '/o/headless-commerce-admin-catalog/v1.0/products',
    productSpecifications:
      '/o/headless-commerce-admin-catalog/v1.0/products/{productId}/product-specifications',
    productAttachments:
      '/o/headless-commerce-admin-catalog/v1.0/products/{productId}/product-attachments',

    accounts: '/o/headless-commerce-admin-account/v1.0/accounts',
    accountAddresses:
      '/o/headless-commerce-admin-account/v1.0/accounts/{accountId}/account-addresses',
    accountUsers:
      '/o/headless-commerce-admin-account/v1.0/accounts/{accountId}/account-users',

    orders: '/o/headless-commerce-admin-order/v1.0/orders',
    orderItems:
      '/o/headless-commerce-admin-order/v1.0/orders/{orderId}/order-items',

    channels: '/o/headless-commerce-admin-channel/v1.0/channels',

    priceLists: '/o/headless-commerce-admin-pricing/v1.0/price-lists',
    priceEntries:
      '/o/headless-commerce-admin-pricing/v1.0/price-lists/{priceListId}/price-entries',

    apiExplorer: '/o/api',
  },

  requestConfig: {
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 1000,
  },

  batchConfig: {
    defaultBatchSize: 5,
    maxBatchSize: 20,
    batchDelay: 500,
  },

  errorConfig: {
    logErrors: true,
    includeStackTrace: ENV.NODE_ENV === 'development',
    maxErrorsPerOperation: 10,
  },

  authMethods: {
    BASIC: 'basic',
    OAUTH2: 'oauth2',
  },

  defaultHeaders: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Liferay-Commerce-AI-Generator/1.0',
  },
};
