const LiferayRestService = require('./rest.cjs');
const LiferayGraphQLService = require('./graphql.cjs');
const { asItems, asCount } = require('../../utils/liferayUtils.cjs');
const { PATH } = require('../../utils/liferayPaths.cjs');
const { delay } = require('../../utils/misc.cjs');
const { ERC_PREFIX } = require('../../utils/constants.cjs');

class LiferayService {
  constructor(ctx) {
    this.ctx = ctx;
    this.rest = new LiferayRestService(ctx);
    this.graphql = new LiferayGraphQLService(ctx);
  }

  // --- Discovery Methods (Standardized Entry Points with Exclusions) ---

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

    const filters = [];
    if (catalogId) filters.push(`catalogId eq ${catalogId}`);
    if (providedFilter) filters.push(providedFilter);

    const nameFilter = this._buildNameExclusionFilter(exclusions);
    if (nameFilter) {
      filters.push(nameFilter);
    }

    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const requestedFields = new Set([
      'productId',
      'externalReferenceCode',
      'name',
    ]);
    if (fields) {
      const allowed = new Set([
        'productId',
        'externalReferenceCode',
        'name',
        'id',
        'sku',
      ]);
      fields.split(',').forEach((f) => {
        if (allowed.has(f)) requestedFields.add(f);
      });
    }

    const res = await this.graphql.getProducts(
      config,
      filter,
      Array.from(requestedFields),
      {
        page: 1,
        pageSize,
      }
    );

    const items = asItems(res);
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getAccounts(
    config,
    { channelId, pageSize = 200, fields = 'id', filter: providedFilter } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'account');

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    const prefixFilter = `externalReferenceCode sw '${ERC_PREFIX.ACCOUNT}'`;

    if (channelId) {
      let channelAccountFilter;
      try {
        const res = await this.graphql.getOrders(
          config,
          `channelId eq ${channelId}`,
          ['accountId'],
          {
            page: 1,
            pageSize: 1000,
          }
        );

        const uniqueIds = [
          ...new Set(asItems(res).map((o) => o.accountId)),
        ].filter(Boolean);

        if (uniqueIds.length > 0) {
          channelAccountFilter = `id in (${uniqueIds.join(',')})`;
        }
      } catch (err) {
        this.ctx.logger.warn(
          'Failed to discover accounts via channel orders (GraphQL)',
          { channelId, error: err.message }
        );
      }

      if (channelAccountFilter) {
        filters.push(`(${channelAccountFilter} or ${prefixFilter})`);
      } else {
        filters.push(prefixFilter);
      }
    } else {
      // Fallback to prefix-only discovery if no channel is provided
      filters.push(prefixFilter);
    }

    const nameFilter = this._buildNameExclusionFilter(exclusions);
    if (nameFilter) {
      filters.push(nameFilter);
    }

    let filter = filters.length > 0 ? filters.join(' and ') : null;

    const requestedFields = new Set(['id', 'externalReferenceCode', 'name']);
    if (fields) {
      const allowed = new Set([
        'id',
        'externalReferenceCode',
        'name',
        'type',
        'status',
      ]);
      fields.split(',').forEach((f) => {
        if (allowed.has(f)) requestedFields.add(f);
      });
    }

    const res = await this.graphql.getAccounts(
      config,
      filter,
      Array.from(requestedFields),
      {
        page: 1,
        pageSize,
      }
    );

    const items = asItems(res);
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getOptionCategories(
    config,
    { pageSize = 200, fields = 'id', filter: providedFilter } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'optionCategory');

    const requestedFields = new Set(['id', 'externalReferenceCode', 'title']);
    if (fields) {
      const allowed = new Set([
        'id',
        'externalReferenceCode',
        'title',
        'key',
        'priority',
      ]);
      fields.split(',').forEach((f) => {
        if (allowed.has(f)) requestedFields.add(f);
      });
    }

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    const nameFilter = this._buildNameExclusionFilter(exclusions, 'title');
    if (nameFilter) {
      filters.push(nameFilter);
    }
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const res = await this.graphql.getOptionCategories(
      config,
      filter,
      Array.from(requestedFields),
      {
        page: 1,
        pageSize,
      }
    );
    const items = asItems(res);
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount || filteredItems.length,
    };
  }

  async getSpecifications(
    config,
    { pageSize = 200, fields = 'id', filter: providedFilter } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'specification');

    const requestedFields = new Set([
      'id',
      'key',
      'externalReferenceCode',
      'title',
    ]);
    if (fields) {
      const allowed = new Set(['id', 'key', 'externalReferenceCode', 'title']);
      fields.split(',').forEach((f) => {
        if (allowed.has(f)) requestedFields.add(f);
      });
    }

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    const nameFilter = this._buildNameExclusionFilter(exclusions, 'key');
    if (nameFilter) {
      filters.push(nameFilter);
    }
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const res = await this.graphql.getSpecifications(
      config,
      filter,
      Array.from(requestedFields),
      { page: 1, pageSize }
    );
    const items = asItems(res);
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getOptions(
    config,
    { pageSize = 200, fields = 'id', filter: providedFilter } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'option');

    const requestedFields = new Set([
      'id',
      'key',
      'externalReferenceCode',
      'name',
    ]);
    if (fields) {
      const allowed = new Set([
        'id',
        'key',
        'externalReferenceCode',
        'name',
        'fieldType',
      ]);
      fields.split(',').forEach((f) => {
        if (allowed.has(f)) requestedFields.add(f);
      });
    }

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    const nameFilter = this._buildNameExclusionFilter(exclusions);
    if (nameFilter) {
      filters.push(nameFilter);
    }
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const res = await this.graphql.getOptions(
      config,
      filter,
      Array.from(requestedFields),
      { page: 1, pageSize }
    );
    const items = asItems(res);
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getOrders(
    config,
    { pageSize = 200, fields = 'id', filter: providedFilter } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'order');

    const requestedFields = new Set(['id', 'externalReferenceCode']);
    if (fields) {
      const allowed = new Set([
        'id',
        'externalReferenceCode',
        'orderNumber',
        'status',
        'accountId',
      ]);
      fields.split(',').forEach((f) => {
        if (allowed.has(f)) requestedFields.add(f);
      });
    }

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    const nameFilter = this._buildNameExclusionFilter(exclusions);
    if (nameFilter) {
      filters.push(nameFilter);
    }
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const res = await this.graphql.getOrders(
      config,
      filter,
      Array.from(requestedFields),
      { page: 1, pageSize }
    );
    const items = asItems(res);
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getWarehouses(
    config,
    { pageSize = 200, fields = 'id', filter: providedFilter } = {}
  ) {
    const exclusions = await this._getExclusions(config, 'warehouse');

    const requestedFields = new Set(['id', 'externalReferenceCode', 'name']);
    if (fields) {
      const allowed = new Set(['id', 'externalReferenceCode', 'name']);
      fields.split(',').forEach((f) => {
        if (allowed.has(f)) requestedFields.add(f);
      });
    }

    const filters = [];
    if (providedFilter) filters.push(providedFilter);

    const nameFilter = this._buildNameExclusionFilter(exclusions);
    if (nameFilter) {
      filters.push(nameFilter);
    }
    const filter = filters.length > 0 ? filters.join(' and ') : null;

    const res = await this.graphql.getWarehouses(
      config,
      filter,
      Array.from(requestedFields),
      { page: 1, pageSize }
    );
    const items = asItems(res);
    const filteredItems = items.filter(
      (it) => !this._shouldExclude(it, exclusions)
    );

    return {
      ...res,
      items: filteredItems,
      totalCount: res.totalCount,
    };
  }

  async getWarehouseItems(
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

    for (const warehouse of warehouses.items) {
      try {
        const res = await this.graphql.getWarehouseItems(
          config,
          warehouse.id,
          filter,
          Array.from(requestedFields),
          {
            page: 1,
            pageSize,
          }
        );
        const items = asItems(res);
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
    {
      pageSize = 200,
      fields = 'id',
      type = 'price-list',
      filter: providedFilter,
      search,
      ignoreExclusions = false,
    } = {}
  ) {
    const exclusions = ignoreExclusions
      ? []
      : await this._getExclusions(config, 'priceList');

    // Fetch all price lists without filters or search to avoid Pricing V2.0 REST API limitations
    const res = await this.rest.getPriceLists(config, { pageSize: 1000 });
    const items = asItems(res);

    // Parse catalogId from providedFilter if it exists (e.g. "catalogId eq 123")
    let targetCatalogId = null;
    if (providedFilter && providedFilter.includes('catalogId eq')) {
      const match = providedFilter.match(/catalogId eq (\d+)/);
      if (match) targetCatalogId = parseInt(match[1], 10);
    }

    const filteredItems = items.filter((it) => {
      // Filter by type (robust comparison) - skip if type is explicitly null
      if (type !== null) {
        const normalize = (s) =>
          String(s || '')
            .toLowerCase()
            .replace(/[-_]/g, '');
        if (normalize(it.type) !== normalize(type)) return false;
      }

      // Filter by catalogId if requested
      if (targetCatalogId && Number(it.catalogId) !== Number(targetCatalogId))
        return false;

      // Filter by search term (case-insensitive) if provided
      if (search) {
        const term = search.toLowerCase();
        const nameMatch = it.name?.toLowerCase().includes(term);
        const ercMatch = it.externalReferenceCode?.toLowerCase().includes(term);
        if (!nameMatch && !ercMatch) return false;
      }

      // Filter by exclusions
      return !this._shouldExclude(it, exclusions);
    });

    return {
      ...res,
      items: filteredItems,
      totalCount: filteredItems.length,
    };
  }

  async getPromotions(config, args = {}) {
    return this.getPriceLists(config, { ...args, type: 'promotion' });
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
      const idChunks = this.rest._chunkArray(providedIds, 200);
      for (const idChunk of idChunks) {
        const idFilter =
          entityName === 'product'
            ? `productId in (${idChunk.join(',')})`
            : `id in (${idChunk.join(',')})`;

        const items = await this.rest._collectPagedItems(config, {
          listUrl: rest.listUrl,
          pageSize: 200,
          filter: idFilter,
          fields: fieldsParam,
          op: `${entityName}:list-for-exclusion`,
          friendly: `Fetch ${entityName} for metadata check`,
        });
        await processBatch(items);
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
          res = await this.getWarehouseItems(config, {
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
      listUrl: PATH.PRICE_LISTS,
      op: 'promotions:batch-delete',
      friendly: 'Delete promotions (batch)',
      items,
    });
  }

  async deleteProductsBatch(
    config,
    {
      pageSize = 200,
      filter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
      catalogId,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'product',
      filter: filter || (catalogId ? `catalogId eq ${catalogId}` : undefined),
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.PRODUCTS_BATCH,
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
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.ACCOUNTS_BATCH,
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
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'order',
      filter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.ORDERS_BATCH,
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
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'warehouse',
      filter,
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
      callbackBatchERC,
      dryRun = false,
      sessionId,
      items,
    } = {}
  ) {
    return this.deleteByFilter(config, {
      entityName: 'warehouseItem',
      filter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.WAREHOUSE_INVENTORIES_DELETE_BATCH,
      listUrl: PATH.WAREHOUSE_INVENTORIES_DELETE_BATCH('')
        .split('?')[0]
        .replace('/batch', ''),
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
    const res = await this.graphql.getCatalogs(config);
    return asItems(res);
  }

  getCatalog(config, catalogId) {
    return this.rest.getCatalog(config, catalogId);
  }

  async getChannels(config) {
    const res = await this.graphql.getChannels(config);
    return asItems(res);
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

  getSiteLanguages(config, siteGroupId) {
    return this.rest.getSiteLanguages(config, siteGroupId);
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

  addProductOptions(config, productId, productOptions) {
    return this.rest.addProductOptions(config, productId, productOptions);
  }

  deleteProductOption(config, productId, productOptionId) {
    return this.rest.deleteProductOption(config, productId, productOptionId);
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
    return this.graphql.getSkusByERC(config, ercs, fields);
  }
}

module.exports = { LiferayService };
