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

const BASE = {
  CATALOG_API: '/o/headless-commerce-admin-catalog/v1.0',
  PRICING_API: '/o/headless-commerce-admin-pricing/v1.0',
  CHANNEL_API: '/o/headless-commerce-admin-channel/v1.0',
  ORDER_API: '/o/headless-commerce-admin-order/v1.0',
  USER_ADMIN_API: '/o/headless-admin-user/v1.0',
  DELIVERY: '/o/headless-delivery/v1.0',
  C_OBJECT: '/o/c',

  PRODUCTS: '/o/headless-commerce-admin-catalog/v1.0/products',
  OPTIONS: '/o/headless-commerce-admin-catalog/v1.0/options',
  OPTION_CATEGORIES: '/o/headless-commerce-admin-catalog/v1.0/optionCategories',
  SPECIFICATIONS: '/o/headless-commerce-admin-catalog/v1.0/specifications',
  CATALOGS: '/o/headless-commerce-admin-catalog/v1.0/catalogs',
  CHANNELS: '/o/headless-commerce-admin-channel/v1.0/channels',
  ACCOUNTS: '/o/headless-admin-user/v1.0/accounts',
  ORDERS: '/o/headless-commerce-admin-order/v1.0/orders',
  PRICE_LISTS: '/o/headless-commerce-admin-pricing/v1.0/priceLists',
  ME: '/o/headless-admin-user/v1.0/my-user-account',
  CURRENCIES: '/o/headless-commerce-admin-catalog/v1.0/currencies',
  INVENTORY_API: '/o/headless-commerce-admin-inventory/v1.0',
  BATCH_ENGINE_API: '/o/headless-batch-engine/v1.0',
};

const VARIANT = {
  products: 'camel',
  options: 'kebab',
  optionCategories: 'kebab',
  specifications: 'kebab',
};

const CUSTOM_OBJECTS = {
  AICA_CONFIGS: 'aicommerceacceleratorconfigurations',
};

const PATH = {
  BASE,
  VARIANT,
  CUSTOM_OBJECTS,

  WAREHOUSES: `${BASE.INVENTORY_API}/warehouses`,
  WAREHOUSE_INVENTORIES: (warehouseId) =>
    `${BASE.INVENTORY_API}/warehouses/${warehouseId}/inventories`,

  PRODUCTS: BASE.PRODUCTS,
  PRICE_LISTS: BASE.PRICE_LISTS,
  PRODUCTS_BATCH: (callbackURL) =>
    `${BASE.PRODUCTS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,
  PRODUCT_SKUS: (productId) => `${BASE.PRODUCTS}/${productId}/skus`,
  PRODUCT_OPTIONS: (productId) =>
    `${BASE.PRODUCTS}/${productId}/productOptions`,
  PRODUCT_SPECIFICATIONS: (productId) =>
    `${BASE.PRODUCTS}/${productId}/product-specifications`,
  PRODUCT_IMAGES: (productId) => `${BASE.PRODUCTS}/${productId}/images`,
  PRODUCT_ATTACHMENTS: (productId) =>
    `${BASE.PRODUCTS}/${productId}/attachments`,
  PRODUCT_IMAGES_BY_URL: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/images/by-url`,
  PRODUCT_ATTACHMENTS_BY_URL: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/attachments/by-url`,
  PRODUCT_IMAGES_BY_BASE64: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/images/by-base64`,
  PRODUCT_ATTACHMENTS_BY_BASE64: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/attachments/by-base64`,

  OPTIONS: BASE.OPTIONS,
  OPTION_BY_ERC: (erc) => byERC(BASE.OPTIONS, erc, VARIANT.options),
  OPTION_VALUES: (optionId) => `${BASE.OPTIONS}/${optionId}/optionValues`,
  OPTION_VALUE_BY_ERC: (optionId, erc) =>
    byERC(`${BASE.OPTIONS}/${optionId}/optionValues`, erc, VARIANT.options),

  OPTION_CATEGORIES: BASE.OPTION_CATEGORIES,
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
  ACCOUNTS_BATCH: (callbackURL) =>
    `/o/headless-admin-user/v1.0/accounts/batch?callbackURL=${callbackURL}`,

  ORDERS: BASE.ORDERS,
  ORDERS_BATCH: (callbackURL) =>
    `${BASE.ORDERS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,

  CATALOGS: BASE.CATALOGS,
  CHANNELS: BASE.CHANNELS,
  CHANNEL: (channelId) => `${BASE.CHANNELS}/${channelId}`,
  CURRENCIES: BASE.CURRENCIES,
  ME: BASE.ME,

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
    `${BASE.DELIVERY}/document-folders/${folderId}/permissions`,
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
          `PATH.PERMISSIONS_BY_ASSET: unsupported assetType "${assetType}"`
        );
    }
  },

  CUSTOM_OBJECT: (plural) => `${BASE.C_OBJECT}/${plural}`,
  CUSTOM_OBJECT_QUERY: (plural, params) =>
    `${BASE.C_OBJECT}/${plural}${q(params)}`,

  PRICE_LIST_BY_ERC: (erc) =>
    byERC(`${BASE.PRICING_API}/priceLists`, erc, 'camel'),

  PRICE_ENTRIES: (priceListId) =>
    `${BASE.PRICING_API}/priceLists/${enc(priceListId)}/priceEntries`,
  PRICE_ENTRIES_BY_ERC: (priceListERC) =>
    `${byERC(
      `${BASE.PRICING_API}/priceLists`,
      priceListERC,
      'camel'
    )}/priceEntries`,
  PRICE_ENTRY_BY_ERC: (priceEntryERC) =>
    `${BASE.PRICING_API}/priceEntries/by-externalReferenceCode/${enc(
      priceEntryERC
    )}`,

  TIER_PRICES: (priceEntryId) =>
    `${BASE.PRICING_API}/priceEntries/${enc(priceEntryId)}/tierPrices`,
  TIER_PRICES_BY_PRICE_ENTRY_ERC: (priceEntryERC) =>
    `${BASE.PRICING_API}/priceEntries/by-externalReferenceCode/${enc(
      priceEntryERC
    )}/tierPrices`,

  PRICE_LIST_ACCOUNT_GROUPS: (priceListId) =>
    `${BASE.PRICING_API}/priceLists/${enc(priceListId)}/priceListAccountGroups`,
  PRICE_LIST_ACCOUNT_GROUPS_BY_ERC: (priceListERC) =>
    `${byERC(
      `${BASE.PRICING_API}/priceLists`,
      priceListERC,
      'camel'
    )}/priceListAccountGroups`,
  PRICE_LIST_ACCOUNT_GROUP: (id) =>
    `${BASE.PRICING_API}/priceListAccountGroups/${enc(id)}`,

  IMPORT_TASK: (batchId) =>
    `${BASE.BATCH_ENGINE_API}/import-task/${enc(batchId)}`,
  IMPORT_TASK_SUBMITTED_CONTENT: (batchId) =>
    `${BASE.BATCH_ENGINE_API}/import-task/${enc(batchId)}/content`,
  IMPORT_TASK_ERROR_REPORT: (batchId) =>
    `${BASE.BATCH_ENGINE_API}/import-task/${enc(batchId)}/failed-items/report`,
};

module.exports = { PATH, byERC };
