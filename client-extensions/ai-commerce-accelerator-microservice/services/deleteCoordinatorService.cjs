const BaseGenerator = require('../generators/baseGenerator.cjs');
const { asItems } = require('../utils/liferayUtils.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');
const BATCH_STEP_HANDLERS = require('./batch/batch-steps/index.cjs');

const S = WORKFLOW_STEPS;

/**
 * DeleteCoordinatorService - Orchestrates the safe, dependency-aware deletion of AICA data.
 * Inherits from BaseGenerator to leverage the standardized loop-based orchestration.
 */
class DeleteCoordinatorService extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    // Register all deletion steps
    this.steps = {
      [S.DISCOVER]: this._runDiscoveryStep.bind(this),
      [S.RESET_CATALOG_CONFIG]: this._runGenericDeletionStep.bind(
        this,
        'resetCatalogConfiguration'
      ),
      [S.DELETE_ORDERS]: this._runGenericDeletionStep.bind(
        this,
        'deleteOrders'
      ),
      [S.DELETE_WAREHOUSES]: this._runGenericDeletionStep.bind(
        this,
        'deleteWarehouses'
      ),
      [S.DELETE_WAREHOUSE_ITEMS]: this._runGenericDeletionStep.bind(
        this,
        'deleteWarehouseItems'
      ),
      [S.DELETE_ACCOUNTS]: this._runGenericDeletionStep.bind(
        this,
        'deleteAccounts'
      ),
      [S.DELETE_PRODUCTS]: this._runGenericDeletionStep.bind(
        this,
        'deleteProducts'
      ),
      [S.DELETE_PRODUCT_OPTIONS]: this._runGenericDeletionStep.bind(
        this,
        'deleteProductOptions'
      ),
      [S.DELETE_PRODUCT_SPECIFICATIONS]: this._runGenericDeletionStep.bind(
        this,
        'deleteProductSpecifications'
      ),
      [S.DELETE_PRICE_LISTS]: this._runGenericDeletionStep.bind(
        this,
        'deletePriceLists'
      ),
      [S.DELETE_PROMOTIONS]: this._runGenericDeletionStep.bind(
        this,
        'deletePromotions'
      ),
      [S.DELETE_SPECIFICATIONS]: this._runGenericDeletionStep.bind(
        this,
        'deleteSpecifications'
      ),
      [S.DELETE_OPTIONS]: this._runGenericDeletionStep.bind(
        this,
        'deleteOptions'
      ),
      [S.DELETE_OPTION_CATEGORIES]: this._runGenericDeletionStep.bind(
        this,
        'deleteOptionCategories'
      ),
      [S.DELETE_PRODUCT_RELATED]: this._runGenericDeletionStep.bind(
        this,
        'deleteProductRelatedEntities'
      ),
    };
  }

  /**
   * Safe finalize override for deletion flows.
   */
  async _finalizeSession(sessionId, correlationId) {
    if (await this.persistence.tryFinalizeSession(sessionId)) {
      this.logger.info(`Deletion session completed: ${sessionId}`, {
        correlationId,
      });
      this.progress.sessionCompleted({ sessionId, correlationId });
    }
  }

  /**
   * Discovery Phase: Crawls the catalog and channel to build a manifest of IDs to delete.
   * This ensures we capture relationship-dependent IDs while they are still available.
   */
  async _runDiscoveryStep(sessionId) {
    console.log(`[DISCOVERY] >>> Phase started for session: ${sessionId}`);
    const session = await this.persistence.getSession(sessionId);
    if (!session) {
      console.error(
        `[DISCOVERY] !!! Critical: Session not found for ${sessionId}`
      );
      return;
    }

    const { config, channelId, catalogId } = session.context;
    const { correlationId } = session;

    this.logger.info('Starting deletion discovery phase...', {
      sessionId,
      correlationId,
    });

    const manifest = {
      orders: [],
      accounts: [],
      warehouses: [],
      products: [],
      specifications: [],
      options: [],
      optionCategories: [],
      priceLists: [],
      promotions: [],
    };

    try {
      // 1. Discover Orders and their Accounts (Channel Context)
      if (channelId) {
        console.log(`[DISCOVERY] Crawling orders for channel: ${channelId}`);
        this.logger.info(`Discovering all orders for channel ${channelId}...`, {
          sessionId,
        });

        // Use the paginated collection helper from liferayService
        const { items: orders } = await this.liferay._collectAllItems(
          config,
          (cfg, p, size) =>
            this.liferay.graphql.getOrders(
              cfg,
              `channelId eq ${channelId}`,
              ['id', 'accountId', 'externalReferenceCode'],
              { page: p, pageSize: size }
            )
        );

        manifest.orders = orders;
        console.log(`[DISCOVERY] Found ${orders.length} orders.`);
        this.logger.info(
          `Found ${orders.length} orders in channel ${channelId}.`,
          { sessionId }
        );

        // Find accounts linked to these orders
        const accountIds = [
          ...new Set(orders.map((it) => it.accountId)),
        ].filter(Boolean);
        if (accountIds.length > 0) {
          console.log(`[DISCOVERY] Resolving unique accounts from orders...`);
          const accountFilter = accountIds
            .map((id) => `id eq ${id}`)
            .join(' or ');
          const resolvedAccounts = await this.liferay.graphql.getAccounts(
            config,
            accountFilter,
            ['id', 'externalReferenceCode', 'name']
          );
          manifest.accounts = asItems(resolvedAccounts);
          console.log(
            `[DISCOVERY] Found ${manifest.accounts.length} unique accounts from orders.`
          );
          this.logger.info(
            `Identified ${manifest.accounts.length} unique accounts linked to channel orders.`,
            { sessionId }
          );
        }
      }

      // FALLBACK DISCOVERY: If manifest accounts is empty, look for accounts globally
      if (manifest.accounts.length === 0) {
        console.log(
          '[DISCOVERY] No accounts from orders, performing global account discovery...'
        );
        this.logger.info(
          'No accounts found via channel filter, performing global discovery...',
          { sessionId }
        );
        // Use paginated collection helper
        const { items: allAccounts } = await this.liferay._collectAllItems(
          config,
          (cfg, p, size) =>
            this.liferay.graphql.getAccounts(
              cfg,
              null,
              ['id', 'externalReferenceCode', 'name'],
              { page: p, pageSize: size }
            )
        );

        console.log(`[DISCOVERY] Global found ${allAccounts.length} accounts.`);
        this.logger.info(
          `Global discovery found ${allAccounts.length} accounts total.`,
          { sessionId }
        );

        manifest.accounts = allAccounts;
      }

      // WAREHOUSES: Discovery (Global)
      console.log('[DISCOVERY] Crawling warehouses...');
      this.logger.info('Discovering all warehouses...', { sessionId });
      const { items: allWarehouses } = await this.liferay._collectAllItems(
        config,
        (cfg, p, size) =>
          this.liferay.graphql.getWarehouses(
            cfg,
            null,
            ['id', 'externalReferenceCode', 'name'],
            { page: p, pageSize: size }
          )
      );

      console.log(`[DISCOVERY] Found ${allWarehouses.length} warehouses.`);
      this.logger.info(
        `Warehouse discovery found ${allWarehouses.length} total.`,
        { sessionId }
      );

      manifest.warehouses = allWarehouses;

      // WAREHOUSE ITEMS: Discovery (Global via discovered warehouses)
      console.log('[DISCOVERY] Crawling warehouse items...');
      this.logger.info('Discovering all warehouse items...', { sessionId });
      const warehouseItemsRes = await this.liferay.getAllWarehouseItems(
        config,
        { pageSize: 5000 }
      );
      manifest.warehouseItems = warehouseItemsRes.items;
      console.log(
        `[DISCOVERY] Found ${manifest.warehouseItems.length} warehouse items.`
      );
      this.logger.info(
        `Found ${manifest.warehouseItems.length} total warehouse items.`,
        { sessionId }
      );

      // 2. Discover Catalog Entities (Catalog Context)
      if (catalogId) {
        console.log(`[DISCOVERY] Crawling catalog: ${catalogId}`);
        this.logger.debug(`Discovering products for catalog ${catalogId}...`, {
          sessionId,
        });
        const productsRes = await this.liferay.getProducts(config, {
          catalogId,
          fields: 'productId,externalReferenceCode,name',
        });
        manifest.products = productsRes.items;
        console.log(`[DISCOVERY] Found ${manifest.products.length} products.`);

        // RELATIONAL DISCOVERY: Fetch linked entities while products still exist
        if (manifest.products.length > 0) {
          const productIds = manifest.products.map((p) => p.productId || p.id);
          console.log(
            '[DISCOVERY] Resolving specifications/options for products...'
          );
          const specs = await this.liferay.getSpecificationsByProductIds(
            config,
            productIds
          );
          manifest.specifications = specs;

          const opts = await this.liferay.getOptionsByProductIds(
            config,
            productIds
          );
          manifest.options = opts;
          console.log(
            `[DISCOVERY] Found ${manifest.specifications.length} specs and ${manifest.options.length} options.`
          );
        }

        // Discover Price Lists and Promotions
        const priceListsRes = await this.liferay.getPriceLists(config, {
          catalogId,
          fields: 'id,externalReferenceCode,name,catalogBasePriceList',
        });
        manifest.priceLists = priceListsRes.items;

        const promosRes = await this.liferay.getPromotions(config, {
          catalogId,
          fields: 'id,externalReferenceCode,title',
        });
        manifest.promotions = promosRes.items;
        console.log(
          `[DISCOVERY] Found ${manifest.priceLists.length} price lists and ${manifest.promotions.length} promos.`
        );
      }

      // 3. Persist manifest back to session context
      console.log(
        '[DISCOVERY] <<< Manifest building complete. Saving context...'
      );
      const updatedContext = { ...session.context, manifest };
      await this.persistence.updateSessionContext(sessionId, updatedContext);

      this.logger.info('Discovery manifest completed.', {
        sessionId,
        counts: {
          orders: manifest.orders.length,
          accounts: manifest.accounts.length,
          products: manifest.products.length,
          specifications: manifest.specifications.length,
          options: manifest.options.length,
          priceLists: manifest.priceLists.length,
        },
      });

      await this.completeSyncStep(sessionId, S.DISCOVER, 'COMPLETED');
    } catch (error) {
      console.error(`[DISCOVERY] !!! FATAL FAILURE: ${error.message}`);
      this.logger.error(`Discovery phase failed: ${error.message}`, {
        sessionId,
        correlationId,
      });
      throw error;
    }
  }

  /**
   * Generic wrapper for deletion handlers that ensures batch records are created correctly.
   */
  async _runGenericDeletionStep(handlerName, sessionId) {
    const session = await this.persistence.getSession(sessionId);
    if (!session) return;

    const { config, options, channelId, catalogId, manifest } = session.context;
    const { correlationId } = session;

    const stepName = session.currentSteps[0];
    if (!stepName) {
      throw new Error(
        `Execution triggered for ${handlerName} but no current step found in session ${sessionId}`
      );
    }

    // NEW LOGIC: Use the manifest IDs if available, otherwise fallback to existence check
    const manifestMap = {
      [S.DELETE_ACCOUNTS]: manifest?.accounts,
      [S.DELETE_ORDERS]: manifest?.orders,
      [S.DELETE_WAREHOUSES]: manifest?.warehouses,
      [S.DELETE_WAREHOUSE_ITEMS]: manifest?.warehouseItems,
      [S.DELETE_PRODUCTS]: manifest?.products,
      [S.DELETE_SPECIFICATIONS]: manifest?.specifications,
      [S.DELETE_PRODUCT_SPECIFICATIONS]: manifest?.specifications,
      [S.DELETE_OPTIONS]: manifest?.options,
      [S.DELETE_PRODUCT_OPTIONS]: manifest?.options,
      [S.DELETE_PRICE_LISTS]: manifest?.priceLists,
      [S.DELETE_PROMOTIONS]: manifest?.promotions,
    };

    let targetItems = manifestMap[stepName];
    let totalCount = targetItems ? targetItems.length : 0;
    let hasItems = totalCount > 0;

    // Fallback for steps not in manifest or if manifest-first is skipped
    if (!manifest) {
      const check = await this._checkIfEntitiesExist(
        this.liferay,
        config,
        stepName,
        { channelId, catalogId }
      );
      hasItems = check.hasItems;
      totalCount = check.totalCount;
    }

    if (!hasItems) {
      this.logger.info(`No items found for ${stepName}, bypassing.`, {
        sessionId,
        correlationId,
      });
      return await this.completeSyncStep(sessionId, stepName, 'BYPASSED');
    }

    const handler = BATCH_STEP_HANDLERS[handlerName];
    const batchERC = createERC(ERC_PREFIX.BATCH);

    await this.persistence.createBatch({
      erc: batchERC,
      sessionId,
      stepKey: stepName,
      status: 'PREPARED',
      totalCount: totalCount,
    });

    try {
      const result = await handler(this.ctx, {
        config,
        options,
        sessionId,
        session,
        channelId,
        catalogId,
        totalCount,
        batchERC,
        correlationId,
        // Pass manifest items to handler if available
        items: targetItems,
      });

      if (result && result.batchRefs && result.batchRefs.length > 0) {
        const firstBatchId = result.batchRefs[0].taskId;
        await this.persistence.updateBatch(batchERC, {
          status: 'SUBMITTED',
          downstreamBatchId: firstBatchId,
        });

        this.progress.batchStarted({
          sessionId,
          batchERC,
          batchId: firstBatchId,
          totalItems: totalCount,
          entityType: this._normalizeEntityType(stepName),
          operation: 'delete',
          correlationId,
        });
      } else {
        await this.persistence.updateBatch(batchERC, {
          status: 'COMPLETED',
          processedCount: totalCount,
          errorCount: 0,
        });

        await this.completeSyncStep(
          sessionId,
          stepName,
          'COMPLETED',
          totalCount,
          totalCount
        );
      }
    } catch (error) {
      this.logger.error(
        `Deletion step '${stepName}' failed: ${error.message}`,
        { sessionId, batchERC, correlationId }
      );
      await this.persistence.updateBatch(batchERC, { status: 'FAILED' });
      throw error;
    }
  }

  async _checkIfEntitiesExist(liferay, config, stepKey, context) {
    const { channelId, catalogId } = context;

    const checkMap = {
      [S.DELETE_ACCOUNTS]: async () => {
        const res = await liferay.getAccounts(config, { channelId });
        return { totalCount: res.totalCount };
      },
      [S.DELETE_PRODUCTS]: async () => {
        const res = await liferay.getProducts(config, { catalogId });
        return { totalCount: res.totalCount };
      },
      [S.DELETE_ORDERS]: async () => {
        try {
          const res = await liferay.getOrders(config, {
            filter: channelId ? `channelId eq ${channelId}` : undefined,
          });
          return { totalCount: res.totalCount };
        } catch (err) {
          this.logger.warn(
            `Failed to check if orders exist for deletion: ${err.message}. Skipping to avoid crash.`,
            {
              stepKey,
            }
          );
          return { totalCount: 0 };
        }
      },
      [S.DELETE_WAREHOUSES]: async () => {
        const res = await liferay.getWarehouses(config);
        return { totalCount: res.totalCount };
      },
      [S.DELETE_PRICE_LISTS]: async () => {
        const res = await liferay.getPriceLists(config, { catalogId });
        return { totalCount: res.totalCount };
      },
      [S.DELETE_PROMOTIONS]: async () => {
        const res = await liferay.getPromotions(config, { catalogId });
        return { totalCount: res.totalCount };
      },
      [S.RESET_CATALOG_CONFIG]: async () => ({ hasItems: true, totalCount: 1 }),
    };

    if (!checkMap[stepKey]) return { hasItems: true, totalCount: 0 };

    const result = await checkMap[stepKey]();
    return {
      hasItems: (result.totalCount || 0) > 0 || !!result.hasItems,
      totalCount: result.totalCount || 0,
    };
  }

  runDeleteAndMonitor(config, options = {}) {
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);
    const { channelId, catalogId } = config;

    const steps = [
      { name: S.DISCOVER, type: 'sync' },
      { name: S.RESET_CATALOG_CONFIG, type: 'sync' },
      { name: S.DELETE_ORDERS, type: 'sync' },
      { name: S.DELETE_WAREHOUSE_ITEMS, type: 'sync' },
      { name: S.DELETE_WAREHOUSES, type: 'sync' },
      { name: S.DELETE_ACCOUNTS, type: 'sync' },
      { name: S.DELETE_OPTIONS, type: 'sync' },
      { name: S.DELETE_SPECIFICATIONS, type: 'sync' },
      { name: S.DELETE_PRODUCTS, type: 'sync' },
      { name: S.DELETE_PRICE_LISTS, type: 'sync' },
      { name: S.DELETE_PROMOTIONS, type: 'sync' },
      { name: S.DELETE_OPTION_CATEGORIES, type: 'sync' },
    ];

    this.persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: { config, options, sessionId, channelId, catalogId, steps },
    });

    this.logger.info(
      `Full environment deletion session ${sessionId} started.`,
      {
        sessionId,
        correlationId: config.correlationId,
      }
    );

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return { sessionId, message: 'Deletion started.' };
  }

  async runDeleteSelectedAndMonitor(
    config,
    options = {},
    { channelId, catalogId, deleteScope }
  ) {
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

    let steps = Array.isArray(deleteScope)
      ? deleteScope.map((s) => {
          const scopeMap = {
            resetCatalogConfiguration: S.RESET_CATALOG_CONFIG,
            deleteOrders: S.DELETE_ORDERS,
            deleteWarehouses: S.DELETE_WAREHOUSES,
            deleteWarehouseItems: S.DELETE_WAREHOUSE_ITEMS,
            deleteAccounts: S.DELETE_ACCOUNTS,
            deleteProducts: S.DELETE_PRODUCTS,
            deletePriceLists: S.DELETE_PRICE_LISTS,
            deletePromotions: S.DELETE_PROMOTIONS,
          };
          return { ...s, name: scopeMap[s.name] || s.name };
        })
      : [];

    if (steps.length === 0)
      return { sessionId, message: 'No entities selected.' };

    const hasPricing = steps.some(
      (s) => s.name === S.DELETE_PRICE_LISTS || s.name === S.DELETE_PROMOTIONS
    );
    if (hasPricing && !steps.some((s) => s.name === S.RESET_CATALOG_CONFIG)) {
      steps.unshift({ name: S.RESET_CATALOG_CONFIG, type: 'sync' });
    }

    // Always add DISCOVER at the start
    steps.unshift({ name: S.DISCOVER, type: 'sync' });

    await this.persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: { config, options, channelId, catalogId, steps },
    });

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return { sessionId, message: 'Selected deletion started.' };
  }
}

module.exports = DeleteCoordinatorService;
