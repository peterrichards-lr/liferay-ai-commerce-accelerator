const { ENV } = require('../utils/constants.cjs');
const { PATH } = require('../utils/liferayPaths.cjs');

module.exports = {
  endpoints: {
    catalogs: PATH.CATALOGS,
    products: PATH.PRODUCTS,
    productSpecifications: PATH.PRODUCT_SPECIFICATIONS('{productId}'),
    productAttachments: PATH.PRODUCT_ATTACHMENTS('{productId}'),

    accounts: PATH.ACCOUNTS,
    accountAddresses: PATH.ACCOUNT_ADDRESSES('{accountId}'),
    accountUsers: PATH.ACCOUNT_USERS('{accountId}'),

    orders: PATH.ORDERS,
    orderItems: PATH.ORDER_ITEMS('{orderId}'),

    channels: PATH.CHANNELS,

    priceLists: PATH.PRICE_LISTS,
    priceEntries: PATH.PRICE_ENTRIES('{priceListId}'),

    apiExplorer: PATH.API_EXPLORER,
  },

  requestConfig: {
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 1000,
  },

  batchConfig: {
    defaultBatchSize: 5,
    maxBatchSize: 20,
    batchDelay: 100,
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
