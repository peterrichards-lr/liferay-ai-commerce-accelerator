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
  PRICE_LISTS: '/o/headless-commerce-admin-pricing/v1.0/price-lists',
  ME: '/o/headless-admin-user/v1.0/my-user-account',
  CURRENCIES: '/o/headless-commerce-admin-catalog/v1.0/currencies',
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

  PRODUCTS: BASE.PRODUCTS,
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
  OPTION_CATEGORY_BY_ERC: (erc) =>
    byERC(BASE.OPTION_CATEGORIES, erc, VARIANT.optionCategories),

  SPECIFICATIONS: BASE.SPECIFICATIONS,
  SPECIFICATION_BY_ERC: (erc) =>
    byERC(BASE.SPECIFICATIONS, erc, VARIANT.specifications),

  ACCOUNTS: BASE.ACCOUNTS,
  ACCOUNTS_BATCH: (callbackURL) =>
    `${BASE.ACCOUNTS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,

  ORDERS: BASE.ORDERS,
  ORDERS_BATCH: (callbackURL) =>
    `${BASE.ORDERS}/batch${
      callbackURL ? `?callbackURL=${enc(callbackURL)}` : ''
    }`,

  CATALOGS: BASE.CATALOGS,
  CHANNELS: BASE.CHANNELS,
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
};

module.exports = { PATH, byERC };
