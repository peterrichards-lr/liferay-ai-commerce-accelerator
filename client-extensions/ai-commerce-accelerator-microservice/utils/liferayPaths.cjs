const enc = encodeURIComponent;

const byERC = (base, erc, variant = 'camel') =>
  `${base}/${
    variant === 'camel'
      ? 'by-externalReferenceCode'
      : 'by-external-reference-code'
  }/${enc(erc)}`;

// Base endpoints for each API family
const BASE = {
  PRODUCTS: '/o/headless-commerce-admin-catalog/v1.0/products',
  OPTIONS: '/o/headless-commerce-admin-catalog/v1.0/options',
  OPTION_CATEGORIES: '/o/headless-commerce-admin-catalog/v1.0/optionCategories',
  SPECIFICATIONS: '/o/headless-commerce-admin-catalog/v1.0/specifications',
  CATALOGS: '/o/headless-commerce-admin-catalog/v1.0/catalogs',
  CHANNELS: '/o/headless-commerce-admin-channel/v1.0/channels',
  ACCOUNTS: '/o/headless-admin-user/v1.0/accounts',
  ORDERS: '/o/headless-commerce-admin-order/v1.0/orders',
  PRICE_LISTS: '/o/headless-commerce-admin-pricing/v1.0/price-lists',
  DELIVERY: '/o/headless-delivery/v1.0',
  ME: '/o/headless-admin-user/v1.0/my-user-account',
};

// Style variant per API family (camel vs kebab)
const VARIANT = {
  products: 'camel',
  options: 'kebab',
  optionCategories: 'kebab',
  specifications: 'kebab',
  // adjust as needed per API family
};

// Final PATH constants
const PATH = {
  BASE,
  VARIANT,

  // Products
  PRODUCTS: BASE.PRODUCTS,
  PRODUCT_IMAGES_BY_URL: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/images/by-url`,
  PRODUCT_ATTACHMENTS_BY_URL: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/attachments/by-url`,
  PRODUCT_IMAGES_BY_BASE64: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/images/by-base64`,
  PRODUCT_ATTACHMENTS_BY_BASE64: (erc) =>
    `${byERC(BASE.PRODUCTS, erc, VARIANT.products)}/attachments/by-base64`,

  // Options
  OPTION_BY_ERC: (erc) => byERC(BASE.OPTIONS, erc, VARIANT.options),

  // Option categories
  OPTION_CATEGORY_BY_ERC: (erc) =>
    byERC(BASE.OPTION_CATEGORIES, erc, VARIANT.optionCategories),

  // Specifications
  SPECIFICATION_BY_ERC: (erc) =>
    byERC(BASE.SPECIFICATIONS, erc, VARIANT.specifications),

  // Accounts, Orders, Catalogs, Channels
  ACCOUNTS: BASE.ACCOUNTS,
  ORDERS: BASE.ORDERS,
  CATALOGS: BASE.CATALOGS,
  CHANNELS: BASE.CHANNELS,

  // Price lists
  PRICE_LISTS: BASE.PRICE_LISTS,
  PRICE_ENTRIES: (priceListId) =>
    `${BASE.PRICE_LISTS}/${priceListId}/price-entries`,

  // Delivery APIs (site-scoped)
  DOCUMENT_FOLDERS: (siteId) =>
    `${BASE.DELIVERY}/sites/${siteId}/document-folders`,
  DOCUMENT_FOLDER_BY_ERC: (siteId, erc) =>
    `${
      BASE.DELIVERY
    }/sites/${siteId}/document-folders/by-externalReferenceCode/${enc(erc)}`,
  SITE_LANGUAGES: (siteGroupId) =>
    `${BASE.DELIVERY}/sites/${siteGroupId}/languages`,
  SITE_DOCUMENTS: (siteId) => `${BASE.DELIVERY}/sites/${siteId}/documents`,

  // Delivery APIs (id-scoped resources)
  DOCUMENT_FOLDER: (folderId) =>
    `${BASE.DELIVERY}/document-folders/${folderId}`,
  DOCUMENT_FOLDER_PERMISSIONS: (folderId) =>
    `${BASE.DELIVERY}/document-folders/${folderId}/permissions`,

  DOCUMENT: (documentId) => `${BASE.DELIVERY}/documents/${documentId}`,
  DOCUMENT_PERMISSIONS: (documentId) =>
    `${BASE.DELIVERY}/documents/${documentId}/permissions`,

  // Generic permissions resolver (assetType: 'document-folder' | 'document')
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

  // User
  ME: BASE.ME,
};

module.exports = { PATH, byERC };
