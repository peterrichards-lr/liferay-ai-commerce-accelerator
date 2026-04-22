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
    'generate-price-lists',
    'update-catalog-configuration',
    'generate-bulk-pricing',
    'generate-tier-pricing',
    'delete-products',
    'delete-product-related',
    'delete-price-lists',
    'delete-promotions',
    'reset-catalog-configuration',
    'deleteproducts',
    'deletepricelists',
    'deletepromotions',
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

  const images = ['images', 'attach-images', 'process-images'];
  const pdfs = ['pdfs', 'attach-pdfs', 'process-pdfs'];
  const options = [
    'options',
    'link-product-options',
    'delete-options',
    'delete-option-categories',
    'delete-product-options',
    'deleteoptions',
    'deleteproductoptions',
  ];
  const specifications = [
    'specifications',
    'delete-specifications',
    'delete-product-specifications',
    'deletespecifications',
  ];

  if (products.includes(s)) return 'products';
  if (accounts.includes(s)) return 'accounts';
  if (orders.includes(s)) return 'orders';
  if (warehouses.includes(s)) return 'warehouses';
  if (images.includes(s)) return 'images';
  if (pdfs.includes(s)) return 'pdfs';
  if (options.includes(s)) return 'options';
  if (specifications.includes(s)) return 'specifications';

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
