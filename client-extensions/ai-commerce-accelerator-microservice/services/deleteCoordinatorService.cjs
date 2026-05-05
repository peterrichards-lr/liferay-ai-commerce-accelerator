const BaseGenerator = require('../generators/baseGenerator.cjs');
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
      await this.progress.sessionCompleted({ sessionId, correlationId });
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

    const { config, channelId, catalogId, isTotal } = session.context;
    const { correlationId } = session;

    this.logger.info(
      `Starting discovery (${isTotal ? 'TOTAL' : 'SELECTED'})...`,
      {
        sessionId,
        correlationId,
      }
    );

    const manifest = {
      orders: [],
      accounts: [],
      warehouses: [],
      warehouseItems: [],
      products: [],
      specifications: [],
      options: [],
      optionCategories: [],
      priceLists: [],
      promotions: [],
    };

    const isAICA = (erc) => {
      if (!erc) return false;
      // HARDENING: Only match explicit AICA prefix.
      // UUID-based matching is too aggressive as many system entities use UUIDs.
      return erc.startsWith('AICA-');
    };

    try {
      // --- 1. CHANNEL-BASED DISCOVERY (Orders & Linked Accounts) ---
      const activeChannels = [];
      if (isTotal) {
        this.logger.info(
          'TOTAL mode: Fetching all channels for exhaustive order sweep...',
          { sessionId }
        );
        const allChannels = await this.liferay.getChannels(config);
        // Ensure we NEVER include the current channel in a deletion manifest
        // (though discovery here is only for finding child entities)
        activeChannels.push(...allChannels);
      } else if (channelId) {
        activeChannels.push({ id: channelId });
      }

      for (const chan of activeChannels) {
        try {
          this.logger.info(
            `Crawling orders for channel ${chan.id} (${chan.name || 'unnamed'})...`,
            { sessionId }
          );
          const { items: chanOrders } = await this.liferay.getOrders(config, {
            filter: `channelId eq ${chan.id}`,
          });
          manifest.orders.push(...chanOrders);
        } catch (err) {
          this.logger.warn(`Failed to crawl channel ${chan.id}. Skipping.`, {
            sessionId,
            error: err.message,
          });
        }
      }

      // Final Global Sweep for AICA/UUID orders that might be "orphaned" from any channel
      if (isTotal) {
        try {
          const { items: allOrders } = await this.liferay._collectAllItems(
            config,
            (cfg, p, size) =>
              this.liferay.rest._get(
                cfg,
                '/o/headless-commerce-admin-order/v1.0/orders',
                'get-all-orders',
                'Get All Orders',
                { params: { page: p, pageSize: size } }
              )
          );
          const orphanedOrders = allOrders.filter(
            (o) =>
              isAICA(o.externalReferenceCode) &&
              !manifest.orders.some((m) => m.id === o.id)
          );
          manifest.orders.push(...orphanedOrders);
        } catch (err) {
          this.logger.warn('Global order sweep failed. Continuing...', {
            sessionId,
            error: err.message,
          });
        }
      }

      // --- 2. ACCOUNT DISCOVERY (Based on Orders + Prefix) ---
      const accountIdsFromOrders = new Set(
        manifest.orders.map((o) => o.accountId).filter(Boolean)
      );
      const { items: allAccounts } = await this.liferay.getAccounts(config, {
        pageSize: 500,
      });

      const relatedAccounts = allAccounts.filter(
        (a) =>
          accountIdsFromOrders.has(a.id) ||
          (isTotal && isAICA(a.externalReferenceCode)) ||
          (!isTotal && channelId && isAICA(a.externalReferenceCode))
      );
      manifest.accounts = relatedAccounts;

      // --- 3. CATALOG-BASED DISCOVERY (Products, Specs, Options) ---
      const activeCatalogs = [];
      if (isTotal) {
        this.logger.info(
          'TOTAL mode: Fetching all catalogs for exhaustive product sweep...',
          { sessionId }
        );
        const allCatalogs = await this.liferay.getCatalogs(config);
        activeCatalogs.push(...allCatalogs);
      } else if (catalogId) {
        activeCatalogs.push({ id: catalogId });
      }

      for (const cat of activeCatalogs) {
        try {
          this.logger.info(
            `Crawling products for catalog ${cat.id} (${cat.name || 'unnamed'})...`,
            { sessionId }
          );
          const { items: catProducts } = await this.liferay.getProducts(
            config,
            { catalogId: cat.id }
          );
          manifest.products.push(...catProducts);

          // Discovery price lists and promos for this specific catalog
          const { items: catPrices } = await this.liferay.getPriceLists(
            config,
            { catalogId: cat.id }
          );
          manifest.priceLists.push(...catPrices);
          const { items: catPromos } = await this.liferay.getPromotions(
            config,
            { catalogId: cat.id }
          );
          manifest.promotions.push(...catPromos);
        } catch (err) {
          this.logger.warn(`Failed to crawl catalog ${cat.id}. Skipping.`, {
            sessionId,
            error: err.message,
          });
        }
      }

      // Final Global Sweep for Orphaned Products (AICA/UUID)
      if (isTotal) {
        try {
          const { items: allProducts } = await this.liferay.getProducts(
            config,
            { pageSize: 500 }
          );
          const orphanedProducts = allProducts.filter(
            (p) =>
              isAICA(p.externalReferenceCode) &&
              !manifest.products.some((m) => m.id === (p.productId || p.id))
          );
          manifest.products.push(...orphanedProducts);
        } catch (err) {
          this.logger.warn('Global product sweep failed. Continuing...', {
            sessionId,
            error: err.message,
          });
        }
      }

      // RELATIONAL CRAWL: Fetch Specs/Options linked to discovered products
      if (manifest.products.length > 0) {
        const productIds = manifest.products.map((p) => p.productId || p.id);
        const specs = await this.liferay.getSpecificationsByProductIds(
          config,
          productIds
        );
        manifest.specifications.push(...specs);
        const opts = await this.liferay.getOptionsByProductIds(
          config,
          productIds
        );
        manifest.options.push(...opts);
      }

      // Final Global Sweep for Orphaned Specs/Options/Categories (AICA/UUID)
      if (isTotal) {
        const { items: allSpecs } =
          await this.liferay.getSpecifications(config);
        const orphanedSpecs = allSpecs.filter(
          (s) =>
            isAICA(s.externalReferenceCode) &&
            !manifest.specifications.some((m) => m.id === s.id)
        );
        manifest.specifications.push(...orphanedSpecs);

        const { items: allOpts } = await this.liferay.getOptions(config);
        const orphanedOpts = allOpts.filter(
          (o) =>
            isAICA(o.externalReferenceCode) &&
            !manifest.options.some((m) => m.id === o.id)
        );
        manifest.options.push(...orphanedOpts);

        const { items: allCats } =
          await this.liferay.getOptionCategories(config);
        const orphanedCats = allCats.filter(
          (c) =>
            isAICA(c.externalReferenceCode) || c.key === 'specifications-group'
        );
        manifest.optionCategories.push(...orphanedCats);
      }

      // --- 4. WAREHOUSE DISCOVERY ---
      const { items: warehouses } = await this.liferay.getWarehouses(config);
      manifest.warehouses = warehouses.filter((w) =>
        isTotal
          ? isAICA(w.externalReferenceCode)
          : channelId && isAICA(w.externalReferenceCode)
      );

      const { items: warehouseItems } = await this.liferay.getAllWarehouseItems(
        config,
        { pageSize: 5000 }
      );
      manifest.warehouseItems = warehouseItems.filter((wi) =>
        isTotal
          ? isAICA(wi.externalReferenceCode)
          : channelId && isAICA(wi.externalReferenceCode)
      );

      // --- deduplicate and finalize ---
      manifest.products = [
        ...new Map(
          manifest.products.map((i) => [i.productId || i.id, i])
        ).values(),
      ];
      manifest.specifications = [
        ...new Map(manifest.specifications.map((i) => [i.id, i])).values(),
      ];
      manifest.options = [
        ...new Map(manifest.options.map((i) => [i.id, i])).values(),
      ];
      manifest.optionCategories = [
        ...new Map(manifest.optionCategories.map((i) => [i.id, i])).values(),
      ];
      manifest.priceLists = [
        ...new Map(manifest.priceLists.map((i) => [i.id, i])).values(),
      ];
      manifest.promotions = [
        ...new Map(manifest.promotions.map((i) => [i.id, i])).values(),
      ];

      this.logger.info(
        `Discovery manifest completed. Found ${manifest.orders.length} orders, ${manifest.products.length} products, ${manifest.accounts.length} accounts.`,
        { sessionId }
      );

      this.logger.info(
        `Discovered ${manifest.specifications.length} total specs, ${manifest.options.length} total options, and ${manifest.optionCategories.length} total groups.`,
        { sessionId }
      );

      // 4. Persist manifest back to session context
      this.logger.info('Manifest building complete. Saving context...', {
        sessionId,
      });
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
          optionCategories: manifest.optionCategories.length,
        },
      });

      // Emit totals to the UI immediately after discovery
      this.progress.stepProgress({
        sessionId,
        entityType: 'orders',
        operation: 'delete',
        processedCount: 0,
        totalCount: manifest.orders.length,
        correlationId,
      });
      this.progress.stepProgress({
        sessionId,
        entityType: 'products',
        operation: 'delete',
        processedCount: 0,
        totalCount: manifest.products.length,
        correlationId,
      });
      this.progress.stepProgress({
        sessionId,
        entityType: 'accounts',
        operation: 'delete',
        processedCount: 0,
        totalCount: manifest.accounts.length,
        correlationId,
      });
      this.progress.stepProgress({
        sessionId,
        entityType: 'warehouses',
        operation: 'delete',
        processedCount: 0,
        totalCount: manifest.warehouses.length,
        correlationId,
      });
      this.progress.stepProgress({
        sessionId,
        entityType: 'specifications',
        operation: 'delete',
        processedCount: 0,
        totalCount: manifest.specifications.length,
        correlationId,
      });
      this.progress.stepProgress({
        sessionId,
        entityType: 'options',
        operation: 'delete',
        processedCount: 0,
        totalCount: manifest.options.length + manifest.optionCategories.length,
        correlationId,
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
      [S.DELETE_OPTION_CATEGORIES]: manifest?.optionCategories,
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

    // IMPROVED LOGIC: Perform a final real-time check before bypassing
    // This ensures we catch entities that might have been missed in discovery
    if (!hasItems) {
      const finalCheck = await this._checkIfEntitiesExist(
        this.liferay,
        config,
        stepName,
        { channelId, catalogId, options }
      );
      hasItems = finalCheck.hasItems;
      totalCount = finalCheck.totalCount;
    }

    if (!hasItems) {
      this.logger.info(`Confirmed no items found for ${stepName}, bypassing.`, {
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
          // Use REST for reliable global checking
          const res = await liferay.rest._get(
            config,
            '/o/headless-commerce-admin-order/v1.0/orders',
            'check-orders',
            'Check Orders',
            {
              params: {
                filter: channelId ? `channelId eq ${channelId}` : undefined,
                page: 1,
                pageSize: 1,
              },
            }
          );
          return {
            totalCount: res.totalCount || (res.items && res.items.length) || 0,
          };
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
      { name: S.DELETE_ORDERS, type: 'sync' },
      { name: S.DELETE_WAREHOUSE_ITEMS, type: 'sync' },
      { name: S.DELETE_WAREHOUSES, type: 'sync' },
      { name: S.DELETE_PRODUCT_SPECIFICATIONS, type: 'sync' },
      { name: S.DELETE_PRODUCT_OPTIONS, type: 'sync' },
      { name: S.DELETE_PRODUCTS, type: 'sync' },
      { name: S.DELETE_ACCOUNTS, type: 'sync' },
      { name: S.DELETE_PRICE_LISTS, type: 'sync' },
      { name: S.DELETE_PROMOTIONS, type: 'sync' },
      { name: S.DELETE_SPECIFICATIONS, type: 'sync' },
      { name: S.DELETE_OPTIONS, type: 'sync' },
      { name: S.DELETE_OPTION_CATEGORIES, type: 'sync' },
      { name: S.RESET_CATALOG_CONFIG, type: 'sync' },
    ];

    this.persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: {
        config,
        options,
        sessionId,
        channelId,
        catalogId,
        steps,
        isTotal: true, // MARK AS TOTAL DELETION
        generator: 'delete',
      },
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
      context: {
        config,
        options,
        channelId,
        catalogId,
        steps,
        generator: 'delete',
      },
    });

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return { sessionId, message: 'Selected deletion started.' };
  }
}

module.exports = DeleteCoordinatorService;
