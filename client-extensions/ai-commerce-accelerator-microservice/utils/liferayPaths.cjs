const enc = encodeURIComponent;

const byERC = (base, erc, variant = 'camel') =>
  `${base}/${
    variant === 'camel'
      ? 'by-externalReferenceCode'
      : 'by-external-reference-code'
  }/${enc(erc)}`;

const q = (params = {}) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

const API_ROOT = {
  ADDRESS: '/o/headless-admin-address/v1.0',
  BATCH: '/o/headless-batch-engine/v1.0',
  CATALOG: '/o/headless-commerce-admin-catalog/v1.0',
  CHANNEL: '/o/headless-commerce-admin-channel/v1.0',
  DELIVERY: '/o/headless-delivery/v1.0',
  INVENTORY: '/o/headless-commerce-admin-inventory/v1.0',
  OBJECT: '/o/c',
  ORDER: '/o/headless-commerce-admin-order/v1.0',
  PRICING: '/o/headless-commerce-admin-pricing/v2.0',
  USER: '/o/headless-admin-user/v1.0',
};

const BASE = {
  ADDRESS_ADMIN_API: API_ROOT.ADDRESS,
  BATCH_ENGINE_API: API_ROOT.BATCH,
  CATALOG_API: API_ROOT.CATALOG,
  CHANNEL_API: API_ROOT.CHANNEL,
  DELIVERY: API_ROOT.DELIVERY,
  INVENTORY_API: API_ROOT.INVENTORY,
  C_OBJECT: API_ROOT.OBJECT,
  ORDER_API: API_ROOT.ORDER,
  PRICING_API: API_ROOT.PRICING,
  USER_ADMIN_API: API_ROOT.USER,

  ACCOUNTS: `${API_ROOT.USER}/accounts`,
  CATALOGS: `${API_ROOT.CATALOG}/catalogs`,
  CHANNELS: `${API_ROOT.CHANNEL}/channels`,
  CURRENCIES: `${API_ROOT.CATALOG}/currencies`,
  ME: `${API_ROOT.USER}/my-user-account`,
  OPTION_CATEGORIES: `${API_ROOT.CATALOG}/optionCategories`,
  OPTIONS: `${API_ROOT.CATALOG}/options`,
  ORDERS: `${API_ROOT.ORDER}/orders`,
  POSTAL_ADDRESSES: `${API_ROOT.USER}/postal-addresses`,
  PRICE_LISTS: `${API_ROOT.PRICING}/price-lists`,
  PRODUCTS: `${API_ROOT.CATALOG}/products`,
  SPECIFICATIONS: `${API_ROOT.CATALOG}/specifications`,
};

const VARIANT = {
  optionCategories: 'camel',
  options: 'camel',
  postalAddresses: 'kebab',
  pricing: 'kebab',
  products: 'camel',
  specifications: 'kebab',
};

const CUSTOM_OBJECTS = {
  AICA_CONFIGS: 'aicommerceacceleratorconfigurations',
};

const PATH = {
  BASE,
  VARIANT,
  CUSTOM_OBJECTS,

  API_EXPLORER: '/o/api',

  WAREHOUSES: `${BASE.INVENTORY_API}/warehouses`,
  WAREHOUSE_INVENTORIES: (warehouseId) =>
    `${BASE.INVENTORY_API}/warehouses/${warehouseId}/warehouseItems`,
  WAREHOUSE_INVENTORIES_BATCH: (callbackURL) =>
    `${BASE.INVENTORY_API}/warehouses/warehouseItems/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,
  WAREHOUSE_INVENTORY_BATCH_SCOPED: (warehouseId, warehouseERC, callbackURL) => {
    const params = { callbackURL };
    if (warehouseId) params.warehouseId = warehouseId;
    if (warehouseERC) params.externalReferenceCode = warehouseERC;
    return `${BASE.INVENTORY_API}/warehouses/warehouseItems/batch${q(params)}`;
  },
  WAREHOUSE_INVENTORIES_DELETE_BATCH: (callbackURL) =>
    `${BASE.INVENTORY_API}/warehouseItems/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,

  PRODUCTS: BASE.PRODUCTS,
  PRICE_LISTS: BASE.PRICE_LISTS,
  PRICE_LIST: (priceListId) => `${BASE.PRICE_LISTS}/${priceListId}`,
  PRICE_LISTS_BATCH: (callbackURL) =>
    `${BASE.PRICE_LISTS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,
      PRICE_ENTRIES_BATCH: (callbackURL) =>
        `${BASE.PRICE_LISTS}/price-entries/batch${
          callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
        }`,
      PRICE_LIST_PRICE_ENTRIES_BATCH: (priceListERC, callbackURL) =>
        `${BASE.PRICE_LISTS}/by-externalReferenceCode/${priceListERC}/price-entries/batch${
          callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
        }`,  PRODUCTS_BATCH: (callbackURL) =>
    `${BASE.PRODUCTS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,
  PRODUCTS_SKUS_BATCH: (callbackURL) =>
    `${BASE.PRODUCTS}/skus/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,
  PRODUCT_SKUS_BATCH_SCOPED: (productId, productERC, callbackURL) => {
    const params = { callbackURL };
    if (productId) params.productId = productId;
    if (productERC) params.externalReferenceCode = productERC;
    return `${BASE.PRODUCTS}/skus/batch${q(params)}`;
  },
  WAREHOUSES_BATCH: (callbackURL) =>
    `${BASE.INVENTORY_API}/warehouses/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,
  PRODUCT_SKUS: (productId) => `${BASE.PRODUCTS}/${productId}/skus`,
  PRODUCT_OPTIONS: (productId) =>
    `${BASE.PRODUCTS}/${productId}/productOptions`,
  PRODUCT_OPTION: (id) => `${BASE.CATALOG_API}/productOptions/${id}`,
  PRODUCT_SPECIFICATIONS: (productId) =>
    `${BASE.PRODUCTS}/${productId}/productSpecifications`,
  PRODUCT_SPECIFICATION: (id) =>
    `${BASE.CATALOG_API}/productSpecifications/${id}`,
  PRODUCT_IMAGES: (productId) => `${BASE.PRODUCTS}/${productId}/images`,
  PRODUCT_ATTACHMENTS: (productId) =>
    `${BASE.PRODUCTS}/${productId}/attachments`,
  PRODUCT_IMAGES_BY_URL: (productId) =>
    `${BASE.PRODUCTS}/${productId}/images/by-url`,
  PRODUCT_ATTACHMENTS_BY_URL: (productId) =>
    `${BASE.PRODUCTS}/${productId}/attachments/by-url`,
  PRODUCT_IMAGES_BY_BASE64: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/images/by-base64`,
  PRODUCT_ATTACHMENTS_BY_BASE64: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/attachments/by-base64`,

  ATTACHMENT: (id) => `${BASE.CATALOG_API}/attachment/${id}`,

  OPTIONS: BASE.OPTIONS,
  OPTION_BY_ERC: (erc) => byERC(BASE.OPTIONS, erc, VARIANT.options),
  OPTION_VALUE: (optionValueId) =>
    `${BASE.CATALOG_API}/optionValues/${optionValueId}`,
  OPTION_VALUES: (optionId) => `${BASE.OPTIONS}/${optionId}/optionValues`,
  OPTION_VALUE_BY_ERC: (optionId, erc) =>
    byERC(`${BASE.OPTIONS}/${optionId}/optionValues`, erc, VARIANT.options),

  OPTION_CATEGORIES: BASE.OPTION_CATEGORIES,
  OPTION_CATEGORY: (optionCategoryId) =>
    `${BASE.OPTION_CATEGORIES}/${optionCategoryId}`,
  OPTION_CATEGORIES_BATCH: (callbackURL) =>
    `${BASE.OPTION_CATEGORIES}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,

  OPTION_CATEGORY_BY_ERC: (erc) =>
    byERC(BASE.OPTION_CATEGORIES, erc, VARIANT.optionCategories),

  OPTIONS_BATCH: (callbackURL) =>
    `${BASE.OPTIONS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,

  SPECIFICATIONS: BASE.SPECIFICATIONS,
  SPECIFICATION_BY_ERC: (erc) =>
    byERC(BASE.SPECIFICATIONS, erc, VARIANT.specifications),

  SPECIFICATIONS_BATCH: (callbackURL) =>
    `${BASE.SPECIFICATIONS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,

  ACCOUNTS: BASE.ACCOUNTS,
  ACCOUNT: (accountId) => `${BASE.ACCOUNTS}/${accountId}`,
  ACCOUNT_BY_ERC: (erc) => byERC(BASE.ACCOUNTS, erc, 'kebab'),
  ACCOUNT_ADDRESSES: (accountId) =>
    `${BASE.ACCOUNTS}/${accountId}/postal-addresses`,
  ACCOUNT_ADDRESSES_BATCH: (accountId, callbackURL) =>
    `${BASE.ACCOUNTS}/${accountId}/postal-addresses/batch?callbackURL=${enc(callbackURL)}`,
  ACCOUNT_USERS: (accountId) =>
    `${BASE.ACCOUNTS}/${accountId}/user-accounts`,
  ACCOUNTS_BATCH: (callbackURL) =>
    `${BASE.ACCOUNTS}/batch?callbackURL=${enc(callbackURL)}`,

  POSTAL_ADDRESSES: BASE.POSTAL_ADDRESSES,
  POSTAL_ADDRESS: (postalAddressId) =>
    `${BASE.POSTAL_ADDRESSES}/${postalAddressId}`,
  POSTAL_ADDRESS_BY_ERC: (erc) =>
    `${byERC(BASE.POSTAL_ADDRESSES, erc, VARIANT.postalAddresses)}`,

  ORDERS: BASE.ORDERS,
  ORDER: (orderId) => `${BASE.ORDERS}/${orderId}`,
  ORDER_ITEMS: (orderId) => `${BASE.ORDERS}/${orderId}/orderItems`,
  ORDER_ITEM: (orderItemId) =>
    `${BASE.ORDER_API}/orderItems/${orderItemId}`,
  ORDERS_BATCH: (callbackURL) =>
    `${BASE.ORDERS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,

  CATALOGS: BASE.CATALOGS,
  CATALOG: (catalogId) => `${BASE.CATALOGS}/${catalogId}`,
  CHANNELS: BASE.CHANNELS,
  CHANNEL: (channelId) => `${BASE.CHANNELS}/${channelId}`,
  CURRENCIES: BASE.CURRENCIES,
  ME: BASE.ME,

  COUNTRIES: `${BASE.ADDRESS_ADMIN_API}/countries`,
  COUNTRY_REGIONS: (countryId) =>
    `${BASE.ADDRESS_ADMIN_API}/countries/${countryId}/regions`,

  DOCUMENT_FOLDERS: (siteId) =>
    `${BASE.DELIVERY}/sites/${siteId}/document-folders`,
  DOCUMENT_FOLDER_BY_ERC: (siteId, erc) =>
    `${
      BASE.DELIVERY
    }/sites/${siteId}/document-folders/by-externalReferenceCode/${enc(erc)}`,
  SITE_LANGUAGES: (siteGroupId) =>
    `${BASE.DELIVERY}/sites/${siteGroupId}/languages`,
  SITE_DOCUMENTS: (siteId) => `${BASE.DELIVERY}/sites/${siteId}/documents`,

  DOCUMENT_FOLDER: (folderId) =>
    `${BASE.DELIVERY}/document-folders/${folderId}`,
  DOCUMENT_FOLDER_PERMISSIONS: (folderId) =>
    `${base.DELIVERY}/document-folders/${folderId}/permissions`,
  DOCUMENT: (documentId) => `${BASE.DELIVERY}/documents/${documentId}`,
  DOCUMENT_PERMISSIONS: (documentId) =>
    `${BASE.DELIVERY}/documents/${documentId}/permissions`,

  PERMISSIONS_BY_ASSET: (assetType, id) => {
    switch (assetType) {
      case 'document-folder':
        return `${BASE.DELIVERY}/document-folders/${id}/permissions`;
      case 'document':
        return `${BASE.DELIVERY}/documents/${id}/permissions`;
      default:
        throw new Error(
          `PATH.PERMISSIONS_BY_ASSET: unsupported assetType "${assetType}"`,
        );
    }
  },

  CUSTOM_OBJECT: (plural) => `${BASE.C_OBJECT}/${plural}`,
  CUSTOM_OBJECT_QUERY: (plural, params) =>
    `${BASE.C_OBJECT}/${plural}${q(params)}`,

  PRICE_LIST_BY_ERC: (erc) =>
    byERC(BASE.PRICE_LISTS, erc, VARIANT.pricing),

  PRICE_ENTRIES: (priceListId) =>
    `${BASE.PRICE_LISTS}/${enc(priceListId)}/price-entries`,
  PRICE_ENTRIES_BY_ERC: (priceListERC) =>
    `${byERC(
      BASE.PRICE_LISTS,
      priceListERC,
      VARIANT.pricing,
    )}/price-entries`,
  PRICE_ENTRY: (id) => `${BASE.PRICING_API}/price-entries/${id}`,
  PRICE_ENTRY_BY_ERC: (erc) =>
    byERC(`${BASE.PRICING_API}/price-entries`, erc, VARIANT.pricing),

  TIER_PRICES: (priceEntryId) =>
    `${BASE.PRICING_API}/price-entries/${enc(priceEntryId)}/tier-prices`,
  TIER_PRICES_BY_PRICE_ENTRY_ERC: (priceEntryERC) =>
    `${byERC(
      `${BASE.PRICING_API}/price-entries`,
      priceEntryERC,
      VARIANT.pricing,
    )}/tier-prices`,

  PRICE_LIST_ACCOUNT_GROUPS: (priceListId) =>
    `${BASE.PRICE_LISTS}/${enc(priceListId)}/price-list-account-groups`,
  PRICE_LIST_ACCOUNT_GROUPS_BY_ERC: (priceListERC) =>
    `${byERC(
      BASE.PRICE_LISTS,
      priceListERC,
      VARIANT.pricing,
    )}/price-list-account-groups`,
  PRICE_LIST_ACCOUNT_GROUP: (id) =>
    `${BASE.PRICING_API}/price-list-account-groups/${enc(id)}`,

  IMPORT_TASK: (batchId) =>
    `${BASE.BATCH_ENGINE_API}/import-task/${enc(batchId)}`,
  IMPORT_TASK_SUBMITTED_CONTENT: (batchId) =>
    `${BASE.BATCH_ENGINE_API}/import-task/${enc(batchId)}/content`,
  IMPORT_TASK_ERROR_REPORT: (batchId) =>
    `${BASE.BATCH_ENGINE_API}/import-task/${enc(batchId)}/failed-items/report`,
};

module.exports = { PATH, byERC, CUSTOM_OBJECTS };
