function normalizeEntityType(t) {
  if (!t) return 'unknown';
  const s = String(t).toLowerCase().trim();

  // Standardized categories
  const products = [
    'products',
    'product-data-generation',
    'create-products',
    'resolve-product-ids',
    'create-product-skus',
    'resolve-sku-ids',
    'update-inventory',
    'inventory',
    'delete-products',
    'delete-product-related',
    'reset-catalog-configuration',
    'deleteproducts',
    'resetcatalogconfiguration',
  ];

  const accounts = [
    'accounts',
    'load-countries',
    'generate-account-data',
    'create-accounts',
    'resolve-account-ids',
    'create-postal-addresses',
    'set-address-defaults',
    'delete-accounts',
    'deleteaccounts',
    'postal-addresses',
    'set-billing-and-shipping-addresses',
  ];

  const orders = [
    'orders',
    'generate-order-data',
    'create-orders',
    'delete-orders',
    'deleteorders',
  ];

  const skus = [
    'skus',
    'create-skus',
    'resolve-sku-ids',
    'create-product-skus',
  ];

  const warehouses = [
    'warehouses',
    'generate-warehouse-data',
    'create-warehouses',
    'resolve-warehouse-ids',
    'delete-warehouses',
    'delete-warehouse-items',
    'deletewarehouses',
    'deletewarehouseitems',
  ];

  const images = ['images', 'attach-images', 'process-images', 'create-images'];
  const pdfs = ['pdfs', 'attach-pdfs', 'process-pdfs', 'create-pdfs'];
  const options = [
    'options',
    'link-product-options',
    'delete-options',
    'delete-option-categories',
    'delete-product-options',
    'deleteoptions',
    'deleteproductoptions',
    'ensure-options',
  ];
  const specifications = [
    'specifications',
    'delete-specifications',
    'delete-product-specifications',
    'deletespecifications',
    'ensure-specifications',
    'ensure-specification-categories',
  ];

  const priceLists = [
    'pricelists',
    'price-lists',
    'generate-price-lists',
    'create-price-lists',
    'delete-price-lists',
    'generate-bulk-pricing',
    'generate-tier-pricing',
    'create-bulk-pricing',
    'create-tier-pricing',
    'sync-delay-pricing',
  ];

  const promotions = [
    'promotions',
    'generate-promotions',
    'create-promotions',
    'delete-promotions',
  ];

  if (products.includes(s)) return 'products';
  if (accounts.includes(s)) return 'accounts';
  if (orders.includes(s)) return 'orders';
  if (skus.includes(s)) return 'skus';
  if (warehouses.includes(s)) return 'warehouses';
  if (images.includes(s)) return 'images';
  if (pdfs.includes(s)) return 'pdfs';
  if (options.includes(s)) return 'options';
  if (specifications.includes(s)) return 'specifications';
  if (priceLists.includes(s)) return 'priceLists';
  if (promotions.includes(s)) return 'promotions';

  // Fallbacks
  if (s.startsWith('product')) return 'products';
  if (s.startsWith('order')) return 'orders';
  if (s.startsWith('account')) return 'accounts';
  if (s.startsWith('image')) return 'images';
  if (s.startsWith('pdf')) return 'pdfs';
  if (s.startsWith('warehouse')) return 'warehouses';

  return s;
}

export { normalizeEntityType };
