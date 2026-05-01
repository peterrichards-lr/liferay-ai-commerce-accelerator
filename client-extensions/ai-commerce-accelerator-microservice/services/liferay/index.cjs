const LiferayRestService = require('./rest.cjs');
const LiferayGraphQLService = require('./graphql.cjs');
const { asItems } = require('../../utils/liferayUtils.cjs');
const { PATH } = require('../../utils/liferayPaths.cjs');

class LiferayService {
  constructor(ctx) {
    this.ctx = ctx;
    this.rest = new LiferayRestService(ctx);
    this.graphql = new LiferayGraphQLService(ctx);
    this.ctx.logger.debug('LiferayService: GraphQL client initialized');
  }

  async _collectAllItems(config, fetcherFn, maxItems = 5000) {
    let allItems = [];
    let page = 1;
    const pageSize = 200;
    let hasMore = true;

    while (hasMore) {
      const res = await fetcherFn(config, page, pageSize);
      const items = asItems(res);

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      allItems.push(...items);

      if (items.length < pageSize || allItems.length >= maxItems) {
        hasMore = false;
      } else {
        page++;
      }
    }

    return { items: allItems, totalCount: allItems.length };
  }

  // --- Discovery Methods (Standardized Entry Points with Exclusions) ---

  async getProductsWithSkus(config, { catalogId, pageSize = 200 } = {}) {
    const { items } = await this.graphql.getProducts(
      config,
      catalogId ? `catalogId eq ${catalogId}` : null,
      [
        'id',
        'externalReferenceCode',
        'productId',
        'name',
        'productStatus',
        'skus { sku purchasable price }',
      ],
      { page: 1, pageSize }
    );
    return { items, totalCount: items.length };
  }

  async getProducts(
    config,
    {
      catalogId,
      pageSize = 200,
      fields = 'productId',
      filter: providedFilter,
    } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'product');

    // HARDENING: Liferay's /products API throws 404 if no catalogId is provided.
    // If we want a "Global" search, we MUST iterate through all catalogs.
    if (!catalogId && !providedFilter?.includes('catalogId')) {
      this.ctx.logger.info(
        'Performing multi-catalog product discovery sweep...'
      );
      const allCatalogs = await this.getCatalogs(config);
      const allItems = [];

      for (const cat of allCatalogs) {
        try {
          const { items } = await this.getProducts(config, {
            catalogId: cat.id,
            pageSize,
            fields,
          });
          allItems.push(...items);
        } catch (err) {
          this.ctx.logger.warn(
            `Skipping products for catalog ${cat.id}: ${err.message}`
          );
        }
      }

      // Deduplicate and filter in memory
      const filteredItems = [
        ...new Map(allItems.map((i) => [i.productId || i.id, i])).values(),
      ].filter((it) => !this._shouldExclude(it, exclusions));

      return {
        items: filteredItems,
        totalCount: filteredItems.length,
      };
    }

    // Standard single-catalog fetch
    const filters = [];
    if (catalogId) filters.push(`catalogId eq ${catalogId}`);
    if (providedFilter) filters.push(providedFilter);

    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const { items } = await this._collectAllItems(config, (cfg, p, size) =>
      this.rest._get(
        cfg,
        PATH.PRODUCTS,
        'get-products-bulk',
        'Get Products Bulk',
        {
          params: {
            filter,
            page: p,
            pageSize: size,
          },
        }
      )
    );

    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      items: filteredItems,
      totalCount: filteredItems.length,
    };
  }

  async getAccounts(
    config,
    {
      channelId: _channelId,
      pageSize = 200,
      fields: _fields = 'id',
      filter: providedFilter,
      search,
    } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'account');

    // HARDENING: Fetch all accounts without OData filters
    // (Liferay's Account API rejects 'id' and 'name' filters in many environments)
    let { items } = await this._collectAllItems(config, (cfg, p, size) =>
      this.rest._get(
        cfg,
        PATH.ACCOUNTS,
        'get-accounts-bulk',
        'Get Accounts Bulk',
        {
          params: {
            page: p,
            pageSize: size,
          },
        }
      )
    );

    // Filter 1: Provided OData filter (Simulated in JS memory)
    // We only support simple "id eq" or "externalReferenceCode eq" simulation
    if (providedFilter) {
      const idMatch = providedFilter.match(/id eq (\d+)/);
      const ercMatch = providedFilter.match(
        /externalReferenceCode eq '([^']+)'/
      );

      if (idMatch) {
        const targetId = parseInt(idMatch[1], 10);
        items = items.filter((it) => it.id === targetId);
      } else if (ercMatch) {
        const targetErc = ercMatch[1];
        items = items.filter((it) => it.externalReferenceCode === targetErc);
      }
    }

    // Filter 2: Name Exclusions
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    // Filter 3: Search Term
    const finalItems = search
      ? filteredItems.filter(
          (it) =>
            it.name?.toLowerCase().includes(search.toLowerCase()) ||
            it.externalReferenceCode
              ?.toLowerCase()
              .includes(search.toLowerCase())
        )
      : filteredItems;

    return {
      items: finalItems,
      totalCount: finalItems.length,
    };
  }

  async getOptionCategories(
    config,
    {
      page: _page = 1,
      pageSize: _pageSize = 200,
      fields: _fields = 'id',
      filter: providedFilter,
      ercPrefix,
    } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'optionCategory');

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    // REMOVAL: Do not use OData for name exclusions (unreliable)
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const { items: allItems } = await this._collectAllItems(
      config,
      (cfg, p, size) =>
        this.rest._get(
          cfg,
          PATH.OPTION_CATEGORIES,
          'get-option-categories-bulk',
          'Get Option Categories Bulk',
          {
            params: {
              filter,
              page: p,
              pageSize: size,
            },
          }
        )
    );
    let items = allItems;

    // Apply prefix filter in JS memory
    if (ercPrefix) {
      items = items.filter(
        (it) =>
          it.externalReferenceCode &&
          it.externalReferenceCode.startsWith(ercPrefix)
      );
    }

    // HARDENING: Perform all exclusions in JS memory
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      items: filteredItems,
      totalCount: filteredItems.length,
    };
  }

  async getSpecifications(
    config,
    {
      page: _page = 1,
      pageSize: _pageSize = 200,
      fields: _fields = 'id',
      filter: providedFilter,
      ercPrefix,
    } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'specification');

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    // REMOVAL: Do not use OData for name exclusions (unreliable)
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const { items: allItems } = await this._collectAllItems(
      config,
      (cfg, p, size) =>
        this.rest._get(
          cfg,
          PATH.SPECIFICATIONS,
          'get-specifications-bulk',
          'Get Specifications Bulk',
          {
            params: {
              filter,
              page: p,
              pageSize: size,
            },
          }
        )
    );

    let items = allItems;

    // Apply prefix filter in JS memory
    if (ercPrefix) {
      items = items.filter(
        (it) =>
          it.externalReferenceCode &&
          it.externalReferenceCode.startsWith(ercPrefix)
      );
    }

    // HARDENING: Perform all exclusions in JS memory
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      items: filteredItems,
      totalCount: filteredItems.length,
    };
  }

  async getOptions(
    config,
    {
      page: _page = 1,
      pageSize: _pageSize = 200,
      fields: _fields = 'id',
      filter: providedFilter,
      ercPrefix,
    } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'option');

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    // REMOVAL: Do not use OData for name exclusions (unreliable)
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const { items: allItems } = await this._collectAllItems(
      config,
      (cfg, p, size) =>
        this.rest._get(
          cfg,
          PATH.OPTIONS,
          'get-options-bulk',
          'Get Options Bulk',
          {
            params: {
              filter,
              page: p,
              pageSize: size,
            },
          }
        )
    );
    let items = allItems;

    // Apply prefix filter in JS memory
    if (ercPrefix) {
      items = items.filter(
        (it) =>
          it.externalReferenceCode &&
          it.externalReferenceCode.startsWith(ercPrefix)
      );
    }

    // HARDENING: Perform all exclusions in JS memory
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      items: filteredItems,
      totalCount: filteredItems.length,
    };
  }

  async getOrders(
    config,
    {
      pageSize: _pageSize = 200,
      fields: _fields = 'id',
      filter: providedFilter,
    } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'order');

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    // REMOVAL: Do not use OData for name/status exclusions (unreliable)
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    // Brute force discovery
    const { items } = await this._collectAllItems(config, (cfg, p, size) =>
      this.rest._get(cfg, PATH.ORDERS, 'get-orders-bulk', 'Get Orders Bulk', {
        params: {
          filter,
          page: p,
          pageSize: size,
        },
      })
    );

    // HARDENING: Perform all exclusions in JS memory
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      items: filteredItems,
      totalCount: filteredItems.length,
    };
  }

  async getWarehouses(
    config,
    {
      pageSize: _pageSize = 200,
      fields: _fields = 'id',
      filter: providedFilter,
    } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'warehouse');

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    // REMOVAL: Do not use OData for name exclusions (unreliable)
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    // Brute force discovery
    const { items } = await this._collectAllItems(config, (cfg, p, size) =>
      this.rest._get(
        cfg,
        PATH.WAREHOUSES,
        'get-warehouses-bulk',
        'Get Warehouses Bulk',
        {
          params: {
            filter,
            page: p,
            pageSize: size,
          },
        }
      )
    );

    // HARDENING: Perform all exclusions in JS memory
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      items: filteredItems,
      totalCount: filteredItems.length,
    };
  }

  async getAllWarehouseItems(
    config,
    { pageSize = 200, fields = 'id', filter } = {}
  ) {
    const warehouses = await this.getWarehouses(config, { pageSize: 1000 });
    const allItems = [];
    let totalCount = 0;

    // Standardize requested fields for GraphQL
    const requestedFields = new Set([
      'id',
      'externalReferenceCode',
      'sku',
      'quantity',
    ]);
    if (fields) {
      fields.split(',').forEach((f) => requestedFields.add(f.trim()));
    }

    const filters = [];
    if (filter) filters.push(filter);
    const combinedFilter = filters.length > 0 ? filters.join(' and ') : null;

    for (const warehouse of warehouses.items) {
      try {
        const res = await this.graphql.getWarehouseItems(
          config,
          warehouse.id,
          combinedFilter,
          Array.from(requestedFields),
          {
            page: 1,
            pageSize,
          }
        );
        let items = asItems(res);

        allItems.push(...items);
        totalCount += res.totalCount || items.length;
      } catch (err) {
        this.ctx.logger.warn(
          `Failed to list warehouse items via GraphQL for ${warehouse.id}`,
          { error: err.message }
        );
      }

      if (allItems.length >= pageSize) break;
    }

    return { items: allItems, totalCount };
  }

  async getPriceLists(
    config,
    { catalogId, pageSize = 200, filter: providedFilter } = {}
  ) {
    // HARDENING: Pricing V2.0 GraphQL and REST filters are unstable in 2025.Q1.
    // Specifically, 'catalogId eq' triggers "Collection not allowed".
    // We permanently switch to Iterative REST Discovery with Memory Filtering.

    if (!catalogId && !providedFilter?.includes('catalogId')) {
      this.ctx.logger.info(
        'Performing multi-catalog price list discovery sweep...'
      );
      const allCatalogs = await this.getCatalogs(config);
      const allItems = [];

      for (const cat of allCatalogs) {
        try {
          const { items } = await this.rest.getPriceLists(config, {
            catalogId: cat.id,
            pageSize,
          });
          allItems.push(...items);
        } catch (err) {
          this.ctx.logger.warn(
            `Skipping price lists for catalog ${cat.id}: ${err.message}`
          );
        }
      }

      // Deduplicate and filter in memory
      const filteredItems = [
        ...new Map(allItems.map((i) => [i.id, i])).values(),
      ];

      return {
        items: filteredItems,
        totalCount: filteredItems.length,
      };
    }

    // Standard single-catalog fetch via REST but with MEMORY FILTERING
    // We fetch without the catalogId filter to avoid "Collection not allowed"
    const { items } = await this.rest.getPriceLists(config, {
      pageSize,
      filter: providedFilter,
    });

    const filteredItems = items.filter(
      (it) => !catalogId || Number(it.catalogId) === Number(catalogId)
    );

    return {
      items: filteredItems,
      totalCount: filteredItems.length,
    };
  }

  async getPromotions(config, args = {}) {
    // HARDENING: Switch to memory filtering for promotions to avoid OData issues
    const { items } = await this.getPriceLists(config, args);
    const filtered = items.filter((it) => it.type === 'promotion');

    return {
      items: filtered,
      totalCount: filtered.length,
    };
  }

  // --- Filtered Deletion Loop ---

  async deleteByFilter(
    config,
    {
      entityName,
      filter,
      nativeBatch,
      ids: providedIds,
      items: providedItems,
      channelId,
      ...rest
    }
  ) {
    const { logger } = this.ctx;

    const exclusions = await this._getExclusions(config, entityName);

    // Define discovery fields per entity to avoid GraphQL DataFetchingException
    const DISCOVERY_FIELDS = {
      product: 'productId,externalReferenceCode,name',
      account: 'id,externalReferenceCode,name',
      warehouse: 'id,externalReferenceCode,name',
      warehouseItem: 'id,externalReferenceCode,sku,quantity',
      priceList: 'id,externalReferenceCode,name,catalogBasePriceList',
      promotion: 'id,externalReferenceCode,name,catalogBasePriceList',
      order: 'id,externalReferenceCode',
      specification: 'id,externalReferenceCode,title,key',
      option: 'id,externalReferenceCode,name,key',
      optionCategory: 'id,externalReferenceCode,title,key',
    };

    const fieldsParam =
      DISCOVERY_FIELDS[entityName] || 'id,externalReferenceCode,name';

    let totalDeleted = 0;
    const batchRefs = [];

    const processBatch = async (items) => {
      const filteredItems = items.filter(
        (it) => !this._shouldExclude(it, exclusions)
      );

      const ids = filteredItems
        .map((it) =>
          entityName === 'product'
            ? it.productId || it.id
            : it.id || it.productId
        )
        .filter(Boolean);

      if (ids.length === 0) return;

      let result;
      if (nativeBatch) {
        result = await this.rest._deleteBatchNative(config, {
          entityName,
          ids,
          idField: entityName === 'product' ? 'productId' : 'id',
          ...rest,
        });
      } else {
        result = await this.rest._deleteBatchSimulated(config, {
          entityName,
          ids,
          ...rest,
        });
      }

      totalDeleted += result.count || 0;
      if (result.batchRefs) batchRefs.push(...result.batchRefs);
    };

    if (providedItems && providedItems.length > 0) {
      const chunks = this.rest._chunkArray(providedItems, 500);
      for (const chunk of chunks) {
        await processBatch(chunk);
      }
    } else if (providedIds && providedIds.length > 0) {
      const idChunks = this.rest._chunkArray(providedIds, 100); // Smaller chunks for large OR filters
      for (const idChunk of idChunks) {
        // Resolve full metadata for these IDs to check exclusions
        // Use 'or' instead of 'in' for maximum compatibility
        const idFilter = idChunk
          .map((id) =>
            entityName === 'product' ? `productId eq ${id}` : `id eq ${id}`
          )
          .join(' or ');

        try {
          const items = await this.rest._collectPagedItems(config, {
            listUrl: rest.listUrl,
            pageSize: 200,
            filter: idFilter,
            fields: fieldsParam,
            op: `${entityName}:list-for-exclusion`,
            friendly: `Fetch ${entityName} for metadata check`,
          });

          if (items && items.length > 0) {
            await processBatch(items);
          }
        } catch (err) {
          logger.error(
            `Failed to resolve metadata for ${entityName} chunk. Deleting without exclusion check as fallback.`,
            {
              error: err.message,
              sessionId: rest.sessionId,
            }
          );
          // If metadata fetch fails, we fallback to deleting the IDs directly to avoid stalling the workflow
          // Note: Exclusions won't be respected in this fallback case
          await this.rest._deleteBatchSimulated(config, {
            entityName,
            ids: idChunk,
            ...rest,
          });
        }
      }
    } else {
      let page = 1;
      let hasMore = true;
      const pageSize = 200;

      while (hasMore) {
        let res;
        if (entityName === 'account') {
          res = await this.getAccounts(config, {
            channelId,
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'priceList') {
          res = await this.getPriceLists(config, {
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'promotion') {
          res = await this.getPromotions(config, {
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'product') {
          res = await this.getProducts(config, {
            catalogId: rest.catalogId,
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'warehouseItem') {
          res = await this.getAllWarehouseItems(config, {
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'specification') {
          res = await this.getSpecifications(config, {
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'option') {
          res = await this.getOptions(config, {
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'optionCategory') {
          res = await this.getOptionCategories(config, {
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'order') {
          res = await this.getOrders(config, {
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else if (entityName === 'warehouse') {
          res = await this.getWarehouses(config, {
            pageSize,
            fields: fieldsParam,
            filter,
          });
        } else {
          // Absolute REST fallback for non-GraphQL entities
          res = await this.rest._get(
            config,
            rest.listUrl,
            `${entityName}:list`,
            `List ${entityName}`,
            {
              params: {
                page,
                pageSize,
                filter,
                fields: fieldsParam,
              },
            }
          );
        }

        const items = asItems(res);
        if (items.length === 0) {
          hasMore = false;
          break;
        }

        await processBatch(items);

        if (items.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }

        if (page > 1000) {
          logger.warn('Safety break hit in deleteByFilter pagination', {
            entityName,
            sessionId: rest.sessionId,
          });
          break;
        }
      }
    }

    return { success: true, count: totalDeleted, batchRefs };
  }

  async deletePriceListsBatch(
    config,
    {
      pageSize = 200,
      filter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'priceList',
      filter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.PRICE_LISTS_BATCH,
      basePath: PATH.PRICE_LISTS,
      listUrl: PATH.PRICE_LISTS,
      op: 'pricelists:batch-delete',
      friendly: 'Delete price lists (batch)',
      items,
    });
  }

  async deletePromotionsBatch(
    config,
    {
      pageSize = 200,
      filter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'promotion',
      filter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.PRICE_LISTS_BATCH,
      basePath: PATH.PRICE_LISTS,
      listUrl: PATH.PRICE_LISTS,
      op: 'promotions:batch-delete',
      friendly: 'Delete promotions (batch)',
      items,
    });
  }

  async deleteProductsBatch(
    config,
    {
      catalogId,
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'product',
      filter: filter || (catalogId ? `catalogId eq ${catalogId}` : undefined),
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.PRODUCTS_BATCH,
      basePath: PATH.PRODUCTS,
      listUrl: PATH.PRODUCTS,
      op: 'products:batch-delete',
      friendly: 'Delete products (batch)',
      items,
      catalogId,
    });
  }

  async deleteAccountsBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
      channelId,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'account',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.ACCOUNTS_BATCH,
      basePath: PATH.ACCOUNTS,
      listUrl: PATH.ACCOUNTS,
      op: 'accounts:batch-delete',
      friendly: 'Delete accounts (batch)',
      items,
      channelId,
    });
  }

  async deleteOrdersBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'order',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.ORDERS_BATCH,
      basePath: PATH.ORDERS,
      listUrl: PATH.ORDERS,
      op: 'orders:batch-delete',
      friendly: 'Delete orders (batch)',
      items,
    });
  }

  async deleteWarehousesBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'warehouse',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: false,
      basePath: PATH.WAREHOUSES,
      listUrl: PATH.WAREHOUSES,
      op: 'warehouses:batch-delete',
      friendly: 'Delete warehouses (batch)',
      items,
      concurrency: 1,
    });
  }

  async deleteWarehouseItemsBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    const listUrl = PATH.WAREHOUSE_INVENTORIES_DELETE_BATCH('')
      .split('?')[0]
      .replace('/batch', '');

    return this.deleteByFilter(config, {
      entityName: 'warehouseItem',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.WAREHOUSE_INVENTORIES_DELETE_BATCH,
      basePath: listUrl,
      listUrl: listUrl,
      op: 'inventory:batch-delete',
      friendly: 'Delete inventory items (batch)',
      items,
    });
  }

  async deleteSpecificationsBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'specification',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.SPECIFICATIONS_BATCH,
      basePath: PATH.SPECIFICATIONS,
      listUrl: PATH.SPECIFICATIONS,
      op: 'specifications:batch-delete',
      friendly: 'Delete specifications (batch)',
      items,
    });
  }

  async deleteOptionsBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'option',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.OPTIONS_BATCH,
      basePath: PATH.OPTIONS,
      listUrl: PATH.OPTIONS,
      op: 'options:batch-delete',
      friendly: 'Delete options (batch)',
      items,
    });
  }

  async deleteOptionCategoriesBatch(
    config,
    {
      pageSize = 200,
      filter,
      ids,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'optionCategory',
      filter,
      ids,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.OPTION_CATEGORIES_BATCH,
      basePath: PATH.OPTION_CATEGORIES,
      listUrl: PATH.OPTION_CATEGORIES,
      op: 'optionCategories:batch-delete',
      friendly: 'Delete option categories (batch)',
      items,
    });
  }

  // --- Exclusion Helpers ---

  _buildNameExclusionFilter(exclusions, fieldName = 'name') {
    if (!exclusions || exclusions.length === 0) return null;
    const names = exclusions
      .map((ex) => ex.name)
      .filter((n) => n && typeof n === 'string');
    if (names.length === 0) return null;
    return names.map((name) => `${fieldName} ne '${name}'`).join(' and ');
  }

  async _getExclusions(config, entityName) {
    const { config: configService } = this.ctx;
    const excludeLists = await configService.getExcludeLists(config);

    const keyMap = {
      account: 'excludedAccounts',
      product: 'excludedProducts',
      warehouse: 'excludedWarehouses',
      priceList: 'excludedPriceLists',
      promotion: 'excludedPriceLists', // Promotions are in the PriceLists exclude list
      order: 'excludedOrders',
      specification: 'excludedSpecifications',
      option: 'excludedOptions',
      optionCategory: 'excludedOptionCategories',
    };

    const configKey = keyMap[entityName];
    return excludeLists?.[configKey] || [];
  }

  _shouldExclude(item, exclusions) {
    if (item.system === true || item.system === 'true') return true;

    if (
      item.catalogBasePriceList === true ||
      item.catalogBasePriceList === 'true'
    ) {
      if (
        !item.externalReferenceCode ||
        !item.externalReferenceCode.startsWith('AICA-')
      ) {
        return true;
      }
    }

    if (!exclusions || exclusions.length === 0) return false;

    return exclusions.some((ex) => {
      const idMatch =
        ex.entityId &&
        (String(item.id) === String(ex.entityId) ||
          String(item.productId) === String(ex.entityId));
      const ercMatch = ex.erc && item.externalReferenceCode === ex.erc;
      const nameMatch =
        ex.name &&
        (item.name === ex.name ||
          item.title === ex.name ||
          (typeof item.name === 'object' &&
            Object.values(item.name).includes(ex.name)));

      return idMatch || ercMatch || nameMatch;
    });
  }

  // --- Delegated Methods (REST/GraphQL Mix) ---

  testConnection(config) {
    return this.rest.testConnection(config);
  }

  getConfig(config, configKey) {
    return this.rest.getConfig(config, configKey);
  }

  async getCatalogs(config) {
    const res = await this.rest._get(
      config,
      PATH.CATALOGS,
      'get-catalogs-bulk',
      'Get Catalogs Bulk',
      {
        params: { page: 1, pageSize: 100 },
      }
    );
    return asItems(res);
  }

  async getCatalog(config, catalogId) {
    return this.rest.getCatalog(config, catalogId);
  }

  async patchCatalog(config, catalogId, catalogData) {
    return this.rest.patchCatalog(config, catalogId, catalogData);
  }

  async getChannels(config) {
    const res = await this.rest._get(
      config,
      PATH.CHANNELS,
      'get-channels-bulk',
      'Get Channels Bulk',
      {
        params: { page: 1, pageSize: 100 },
      }
    );
    return asItems(res);
  }

  async getLanguages(config, siteKey) {
    const { logger } = this.ctx;
    try {
      if (!siteKey) {
        logger.warn(
          'siteKey is missing for getLanguages, falling back to REST'
        );
        return await this.rest.getLanguages(config, siteKey);
      }

      const res = await this.graphql.getLanguages(config, siteKey);
      const items = asItems(res);

      if (!items || items.length === 0) {
        logger.warn(
          `GraphQL returned 0 languages for site ${siteKey}, falling back to REST`
        );
        return await this.rest.getLanguages(config, siteKey);
      }

      return items.map((lang) => ({
        id: lang.id,
        name: lang.name,
        isDefault: lang.markedAsDefault || false,
      }));
    } catch (err) {
      logger.warn(
        `Failed to fetch languages for site ${siteKey}: ${err.message}. Attempting REST fallback.`
      );
      try {
        return await this.rest.getLanguages(config, siteKey);
      } catch (restErr) {
        logger.error(
          `Critical failure: Failed to fetch languages via GraphQL AND REST for site ${siteKey}.`
        );
        throw restErr;
      }
    }
  }

  getProductCount(config) {
    return this.rest.getProductCount(config);
  }

  getPrimaryAccountId(config) {
    return this.rest.getPrimaryAccountId(config);
  }

  getAccountCount(config) {
    return this.rest.getAccountCount(config);
  }

  getImportTask(config, batchId) {
    return this.rest.getImportTask(config, batchId);
  }

  getImportTaskSubmittedContent(config, batchId) {
    return this.rest.getImportTaskSubmittedContent(config, batchId);
  }

  getImportTaskFailedItemReport(config, batchId) {
    return this.rest.getImportTaskFailedItemReport(config, batchId);
  }

  deleteAll(config, args) {
    return this.deleteByFilter(config, { ...args, filter: undefined });
  }

  createWarehouse(config, warehouseData) {
    return this.rest.createWarehouse(config, warehouseData);
  }

  createWarehousesBatch(config, warehousesData, opts) {
    return this.rest.createWarehousesBatch(config, warehousesData, opts);
  }

  createWarehouseItemsBatch(config, itemsData, opts) {
    return this.rest.createWarehouseItemsBatch(config, itemsData, opts);
  }

  createWarehouseChannelsBatch(config, itemsData, opts) {
    return this.rest.createWarehouseChannelsBatch(config, itemsData, opts);
  }

  deleteWarehouse(config, warehouseId) {
    return this.rest.deleteWarehouse(config, warehouseId);
  }

  updateProductInventory(config, warehouseId, sku, inventoryData) {
    return this.rest.updateProductInventory(
      config,
      warehouseId,
      sku,
      inventoryData
    );
  }

  updateInventory(config, warehouseId, sku, inventoryData) {
    return this.updateProductInventory(config, warehouseId, sku, inventoryData);
  }

  getCurrencies(config) {
    return this.rest.getCurrencies(config);
  }

  createProduct(config, productData) {
    return this.rest.createProduct(config, productData);
  }

  createProductsBatch(config, productsData, opts) {
    return this.rest.createProductsBatch(config, productsData, opts);
  }

  createProductSkusBatch(config, skusData, opts) {
    return this.rest.createProductSkusBatch(config, skusData, opts);
  }

  createAccount(config, accountData) {
    return this.rest.createAccount(config, accountData);
  }

  patchAccount(config, accountId, accountData) {
    return this.rest.patchAccount(config, accountId, accountData);
  }

  patchAccountByERC(config, externalReferenceCode, accountData) {
    return this.rest.patchAccountByERC(
      config,
      externalReferenceCode,
      accountData
    );
  }

  getAccountByERC(config, externalReferenceCode) {
    return this.rest.getAccountByERC(config, externalReferenceCode);
  }

  getPostalAddressByERC(config, externalReferenceCode) {
    return this.rest.getPostalAddressByERC(config, externalReferenceCode);
  }

  async getCountries(config) {
    const { cache } = this.ctx;
    const cacheKey = 'LIFERAY_COUNTRIES';

    let countries = cache.get(cacheKey);
    if (countries) {
      return countries;
    }

    const res = await this.graphql.getCountries(config);
    countries = asItems(res);

    if (countries && countries.length > 0) {
      cache.set(cacheKey, countries, 900000);
    } else {
      this.ctx.logger.warn(
        'Fetched 0 countries from Liferay. Not caching empty result.'
      );
    }

    return countries;
  }

  async getCountryRegions(config, countryId) {
    const { cache } = this.ctx;
    const cacheKey = `LIFERAY_REGIONS_${countryId}`;

    let regions = cache.get(cacheKey);
    if (regions) {
      return regions;
    }

    const res = await this.graphql.getCountryRegions(config, countryId);
    regions = asItems(res);

    cache.set(cacheKey, regions, 900000);
    return regions;
  }

  createAccountAddress(config, accountId, addressData) {
    return this.rest.createAccountAddress(config, accountId, addressData);
  }

  createAccountAddressBatch(config, accountId, addressesData, opts) {
    return this.rest.createAccountAddressBatch(
      config,
      accountId,
      addressesData,
      opts
    );
  }

  createAccountsBatch(config, accountsData, opts) {
    return this.rest.createAccountsBatch(config, accountsData, opts);
  }

  createOrdersBatch(config, ordersData, opts) {
    return this.rest.createOrdersBatch(config, ordersData, opts);
  }

  createOrder(config, orderData) {
    return this.rest.createOrder(config, orderData);
  }

  createPriceList(config, priceListData) {
    return this.rest.createPriceList(config, priceListData);
  }

  patchPriceList(config, priceListId, priceListData) {
    return this.rest.patchPriceList(config, priceListId, priceListData);
  }

  getPriceListByERC(config, externalReferenceCode) {
    return this.rest.getPriceListByERC(config, externalReferenceCode);
  }

  createPriceListsBatch(config, priceListsData, opts) {
    return this.rest.createPriceListsBatch(config, priceListsData, opts);
  }

  createPriceEntriesBatch(config, priceEntriesData, opts) {
    return this.rest.createPriceEntriesBatch(config, priceEntriesData, opts);
  }

  createPriceEntry(config, priceListId, priceEntryData) {
    return this.rest.createPriceEntry(config, priceListId, priceEntryData);
  }

  createSkuPriceEntry(config, priceListId, skuId, priceEntryData) {
    return this.rest.createSkuPriceEntry(
      config,
      priceListId,
      skuId,
      priceEntryData
    );
  }

  createProductSku(config, productId, skuData) {
    return this.rest.createProductSku(config, productId, skuData);
  }

  addProductImage(config, productId, image) {
    return this.rest.addProductImage(config, productId, image);
  }

  addProductDocumentAttachment(config, productId, attachment) {
    return this.rest.addProductDocumentAttachment(
      config,
      productId,
      attachment
    );
  }

  addProductImageByBase64(config, productERC, image) {
    return this.rest.addProductImageByBase64(config, productERC, image);
  }

  addProductDocumentAttachmentByBase64(config, productERC, attachment) {
    return this.rest.addProductDocumentAttachmentByBase64(
      config,
      productERC,
      attachment
    );
  }

  addProductImageMultipart(config, productId, data) {
    return this.rest.addProductImageMultipart(config, productId, data);
  }

  addProductDocumentAttachmentMultipart(config, productId, data) {
    return this.rest.addProductDocumentAttachmentMultipart(
      config,
      productId,
      data
    );
  }

  addProductImageDocumentLibrary(config, productId, data) {
    return this.rest.addProductImageDocumentLibrary(config, productId, data);
  }

  addProductDocumentAttachmentDocumentLibrary(config, productId, data) {
    return this.rest.addProductDocumentAttachmentDocumentLibrary(
      config,
      productId,
      data
    );
  }

  addProductOptions(config, productId, productOptions, productERC) {
    return this.rest.addProductOptions(
      config,
      productId,
      productOptions,
      productERC
    );
  }

  deleteProductOption(config, productId, productOptionId) {
    return this.rest.deleteProductOption(config, productId, productOptionId);
  }

  addProductChannels(config, productId, channelIds, productERC) {
    return this.rest.addProductChannels(
      config,
      productId,
      channelIds,
      productERC
    );
  }

  addWarehouseChannel(config, warehouseId, channelId) {
    return this.rest.addWarehouseChannel(config, warehouseId, channelId);
  }

  async getProductOptions(config, productId) {
    return this.graphql.getOptionsByProductIds(config, [productId]);
  }

  deleteProductSpecification(config, productId, productSpecificationId) {
    return this.rest.deleteProductSpecification(
      config,
      productId,
      productSpecificationId
    );
  }

  async getProductSpecifications(config, productId) {
    return this.graphql.getSpecificationsByProductIds(config, [productId]);
  }

  createOption(config, optionData) {
    return this.rest.createOption(config, optionData);
  }

  createOptionWithReuse(config, optionData) {
    return this.rest.createOptionWithReuse(config, optionData);
  }

  updateOptionById(config, id, payload) {
    return this.rest.updateOptionById(config, id, payload);
  }

  createOptionValue(config, optionId, optionValueData) {
    return this.rest.createOptionValue(config, optionId, optionValueData);
  }

  getOptionByERC(config, externalReferenceCode) {
    return this.rest.getOptionByERC(config, externalReferenceCode);
  }

  getOptionByKey(config, key) {
    return this.rest.getOptionByKey(config, key);
  }

  getOptionValueByERC(config, optionId, externalReferenceCode) {
    return this.rest.getOptionValueByERC(
      config,
      optionId,
      externalReferenceCode
    );
  }

  getOptionValueByKey(config, optionId, key) {
    return this.rest.getOptionValueByKey(config, optionId, key);
  }

  updateOptionValueById(config, optionId, valueId, payload) {
    return this.rest.updateOptionValueById(config, optionId, valueId, payload);
  }

  updateOptionValueByERC(config, optionId, externalReferenceCode, payload) {
    return this.rest.updateOptionValueByERC(
      config,
      optionId,
      externalReferenceCode,
      payload
    );
  }

  createOptionValueWithReuse(config, optionId, payload) {
    return this.rest.createOptionValueWithReuse(config, optionId, payload);
  }

  createOptionCategory(config, optionCategoryData) {
    return this.rest.createOptionCategory(config, optionCategoryData);
  }

  getOptionCategoryByKey(config, key) {
    return this.rest.getOptionCategoryByKey(config, key);
  }

  updateOptionCategoryById(config, id, payload) {
    return this.rest.updateOptionCategoryById(config, id, payload);
  }

  createOptionCategoryWithReuse(config, payload) {
    return this.rest.createOptionCategoryWithReuse(config, payload);
  }

  getOptionCategoryByERC(config, externalReferenceCode) {
    return this.rest.getOptionCategoryByERC(config, externalReferenceCode);
  }

  updateSpecificationById(config, id, payload) {
    return this.rest.updateSpecificationById(config, id, payload);
  }

  getSpecificationByKey(config, key) {
    return this.rest.getSpecificationByKey(config, key);
  }

  createSpecificationCategoryWithReuse(config, payload) {
    return this.rest.createSpecificationCategoryWithReuse(config, payload);
  }

  createSpecificationWithReuse(config, payload) {
    return this.rest.createSpecificationWithReuse(config, payload);
  }

  setBillingAndShippingAddresses(
    config,
    accountId,
    shippingAddressId,
    billingAddressId
  ) {
    return this.rest.setBillingAndShippingAddresses(
      config,
      accountId,
      shippingAddressId,
      billingAddressId
    );
  }

  // Resilient Resolution Utility
  async resolveByERCsWithRetry(config, ercs, resolverFn, options = {}) {
    const { logger } = this.ctx;
    const label = options.label || 'entities';

    logger.debug(`Starting resolution for ${ercs.length} ${label}...`, {
      correlationId: config.correlationId,
    });

    try {
      // The resolver (usually GraphQL) now handles its own internal retry loop for STALE_INDEX
      const resolvedItems = await resolverFn(config, ercs);

      const resolvedErcs = new Set(
        resolvedItems.filter(Boolean).map((it) => it.externalReferenceCode)
      );
      const missingCount = ercs.filter((erc) => !resolvedErcs.has(erc)).length;

      if (missingCount > 0) {
        logger.warn(
          `Resolution complete for ${label} but ${missingCount} IDs are still missing.`,
          {
            correlationId: config.correlationId,
          }
        );
      } else {
        logger.debug(`Successfully resolved all ${ercs.length} ${label}.`, {
          correlationId: config.correlationId,
        });
      }

      return resolvedItems;
    } catch (error) {
      logger.error(`Critical failure resolving ${label}: ${error.message}`, {
        correlationId: config.correlationId,
        ercCount: ercs.length,
      });
      throw error;
    }
  }

  // Other Coordination/Logic
  getSpecificationsByProductIds(config, productIds, fields) {
    return this.graphql.getSpecificationsByProductIds(
      config,
      productIds,
      fields
    );
  }

  getOptionsByProductIds(config, productIds, fields) {
    return this.graphql.getOptionsByProductIds(config, productIds, fields);
  }

  getAccountsByERC(config, ercs, fields) {
    return this.graphql.getAccountsByERC(config, ercs, fields);
  }

  getProductsByERC(config, ercs, fields) {
    return this.graphql.getProductsByERC(config, ercs, fields);
  }

  getWarehousesByERC(config, ercs, fields) {
    return this.graphql.getWarehousesByERC(config, ercs, fields);
  }

  getPostalAddressesByERC(config, ercs, fields) {
    return this.graphql.getPostalAddressesByERC(config, ercs, fields);
  }

  getSkusByERC(config, ercs, fields) {
    return this.rest.getSkusByERC(config, ercs, fields);
  }

  // --- REST SDK Passthrough ---

  getWarehouseItemsByWarehouseId(config, warehouseId, opts) {
    return this.rest.getWarehouseItems(config, warehouseId, opts);
  }

  getPriceEntries(config, priceListId, opts) {
    return this.rest.getPriceEntries(config, priceListId, opts);
  }
}

module.exports = { LiferayService };
