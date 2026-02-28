function normalizeEntityType(t) {
  if (!t) return 'unknown';
  const s = String(t).toLowerCase().trim();

  // Standardized categories
  if (
    s === 'products' ||
    s === 'product-data-generation' ||
    s === 'resolve-product-ids' ||
    s === 'product-skus' ||
    s === 'update-inventory' ||
    s === 'inventory' ||
    s === 'deleteproducts'
  )
    return 'products';
  if (s === 'accounts' || s === 'postal-addresses' || s === 'deleteaccounts')
    return 'accounts';
  if (s === 'orders' || s === 'deleteorders') return 'orders';
  if (
    s === 'warehouses' ||
    s === 'generate-warehouses' ||
    s === 'resolve-warehouse-ids' ||
    s === 'deletewarehouses' ||
    s === 'deletewarehouseitems'
  )
    return 'warehouses';
  if (s === 'images' || s === 'attach-images' || s === 'process-images')
    return 'images';
  if (s === 'pdfs' || s === 'attach-pdfs' || s === 'process-pdfs')
    return 'pdfs';
  if (
    s === 'specifications' ||
    s === 'deletespecifications' ||
    s === 'deleteproductspecifications'
  )
    return 'specifications';
  if (
    s === 'options' ||
    s === 'link-product-options' ||
    s === 'deleteoptions' ||
    s === 'deleteproductoptions'
  )
    return 'options';
  if (
    s === 'price-lists' ||
    s === 'deletepricelists' ||
    s === 'update-catalog-configuration' ||
    s === 'resetcatalogconfiguration'
  )
    return 'price-lists';
  if (s === 'promotions' || s === 'deletepromotions') return 'promotions';

  // Fallbacks
  if (s.startsWith('product')) return 'products';
  if (s.startsWith('order')) return 'orders';
  if (s.startsWith('account')) return 'accounts';
  if (s.startsWith('image')) return 'images';
  if (s.startsWith('pdf')) return 'pdfs';

  return s;
}

export { normalizeEntityType };
