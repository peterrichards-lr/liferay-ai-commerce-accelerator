/**
 * A Liferay instance, as far as the extract can tell (#849).
 *
 * The extract cannot be pointed at a live instance from a test, so this stands
 * in for one. Two things make it worth trusting rather than merely convenient:
 *
 *   - the DTO shapes are the ones the SDK recorded off a live instance in
 *     `api-schemas/examples/reference-{product,sku,option,specification}.json`,
 *     widened only with fields `headless-commerce-admin-catalog-v1.0-openapi.json`
 *     declares;
 *   - it reproduces the SDK's *lossy* behaviour rather than an idealised one.
 *     `getProductsWithSkus` really does project each SKU down to four fields on
 *     the way past, and a stub that handed back the whole SKU would hide the
 *     reason the extract reads them again.
 */

/**
 * What the product *list* answers with, as observed against a live instance.
 *
 * `GET /v1.0/products` is served from the search index - Liferay's own
 * description says it calls `SearchUtil.search` over `CPDefinition` - so it
 * carries indexed fields only. `description`, `shortDescription`, `urls`,
 * `productType` and the meta fields are not among them, and no parameter
 * brings them back: this endpoint does not support `fields` at all (SDK #210).
 *
 * The stub returned the whole product here, so the extract's suite was green
 * while a live run reported all 22 products incomplete. A stub that is more
 * generous than the system it stands in for tests nothing.
 */
function indexedProduct(product) {
  return {
    catalogId: product.catalogId,
    externalReferenceCode: product.externalReferenceCode,
    name: product.name,
    productId: product.productId ?? product.id,
  };
}

/** Exactly what CommerceService.getProductsWithSkus keeps of each SKU. */
function projectedSku(sku) {
  return {
    externalReferenceCode: sku.externalReferenceCode,
    price: sku.price,
    purchasable: sku.purchasable,
    sku: sku.sku,
  };
}

/**
 * @param {object} instance
 * @param {Array} instance.products `{ attachments, images, options, product,
 *   skus, specifications }` per product.
 * @param {Array} [instance.priceLists] `{ entries, ...priceListDto }`.
 * @param {Array} [instance.warehouses] Warehouse DTOs.
 * @param {number} [instance.pageSizeCeiling] Rows one price-entry page returns,
 *   so a test can force the paging loop to run more than once.
 */
function liferayInstanceStub({
  priceLists = [],
  products = [],
  warehouses = [],
} = {}) {
  const byProductId = new Map(
    products.map((entry) => [
      entry.product.productId ?? entry.product.id,
      entry,
    ])
  );
  const byERC = new Map(
    products.map((entry) => [entry.product.externalReferenceCode, entry])
  );
  const skuByERC = new Map(
    products.flatMap((entry) =>
      (entry.skus || []).map((sku) => [sku.externalReferenceCode, sku])
    )
  );

  const calls = { getPriceEntries: [], getProductById: [], getSkusByERC: [] };

  return {
    calls,

    // The database-backed single read, which does answer with the whole
    // record. This is what the extract hydrates each product from.
    rest: {
      async getProductById(_config, productId) {
        calls.getProductById.push(productId);
        const entry = products.find(
          (e) => (e.product.productId ?? e.product.id) === productId
        );
        return entry ? { ...entry.product } : null;
      },
    },

    async getProductsWithSkus(_config, { catalogId } = {}) {
      const items = products
        .filter(
          (entry) =>
            catalogId === undefined || entry.product.catalogId === catalogId
        )
        .map((entry) => ({
          ...indexedProduct(entry.product),
          skus: (entry.skus || []).map(projectedSku),
        }));

      return { items, totalCount: items.length };
    },

    async getSkusByERC(_config, ercs) {
      calls.getSkusByERC.push(ercs);
      return ercs.map((erc) => skuByERC.get(erc)).filter(Boolean);
    },

    async getProductOptions(_config, productId) {
      return byProductId.get(productId)?.options || [];
    },

    async getProductSpecifications(_config, productId) {
      return byProductId.get(productId)?.specifications || [];
    },

    async getProductImages(_config, productERC) {
      return byERC.get(productERC)?.images || [];
    },

    async getProductAttachments(_config, productERC) {
      return byERC.get(productERC)?.attachments || [];
    },

    async getPriceLists(_config, _options) {
      return {
        items: priceLists.map(({ entries: _entries, ...list }) => list),
        totalCount: priceLists.length,
      };
    },

    // The raw Liferay page envelope, because that is what the SDK's
    // getPriceEntries hands back - and it is the one reader whose totalCount
    // is Liferay's rather than the SDK's own row count.
    async getPriceEntries(_config, priceListId, { page = 1, pageSize = 200 }) {
      calls.getPriceEntries.push({ page, pageSize, priceListId });

      const list = priceLists.find((candidate) => candidate.id === priceListId);
      const entries = list?.entries || [];
      const start = (page - 1) * pageSize;

      return {
        items: entries.slice(start, start + pageSize),
        lastPage: Math.ceil(entries.length / pageSize),
        page,
        pageSize,
        totalCount: entries.length,
      };
    },

    async getWarehouses() {
      return { items: warehouses, totalCount: warehouses.length };
    },
  };
}

module.exports = { liferayInstanceStub, projectedSku };
