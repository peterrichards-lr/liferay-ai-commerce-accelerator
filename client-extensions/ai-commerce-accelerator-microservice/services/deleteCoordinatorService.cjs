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
      [S.RESET_CATALOG_CONFIG]: (sid) =>
        this._runGenericDeletionStep(
          'resetCatalogConfiguration',
          sid,
          S.RESET_CATALOG_CONFIG
        ),
      [S.DELETE_ORDERS]: (sid) =>
        this._runGenericDeletionStep('deleteOrders', sid, S.DELETE_ORDERS),
      [S.DELETE_WAREHOUSES]: (sid) =>
        this._runGenericDeletionStep(
          'deleteWarehouses',
          sid,
          S.DELETE_WAREHOUSES
        ),
      [S.DELETE_WAREHOUSE_ITEMS]: (sid) =>
        this._runGenericDeletionStep(
          'deleteWarehouseItems',
          sid,
          S.DELETE_WAREHOUSE_ITEMS
        ),
      [S.DELETE_ACCOUNTS]: (sid) =>
        this._runGenericDeletionStep('deleteAccounts', sid, S.DELETE_ACCOUNTS),
      [S.DELETE_PRODUCTS]: (sid) =>
        this._runGenericDeletionStep('deleteProducts', sid, S.DELETE_PRODUCTS),
      [S.DELETE_PRODUCT_OPTIONS]: (sid) =>
        this._runGenericDeletionStep(
          'deleteProductOptions',
          sid,
          S.DELETE_PRODUCT_OPTIONS
        ),
      [S.DELETE_PRODUCT_SPECIFICATIONS]: (sid) =>
        this._runGenericDeletionStep(
          'deleteProductSpecifications',
          sid,
          S.DELETE_PRODUCT_SPECIFICATIONS
        ),
      [S.DELETE_PRICE_LISTS]: (sid) =>
        this._runGenericDeletionStep(
          'deletePriceLists',
          sid,
          S.DELETE_PRICE_LISTS
        ),
      [S.DELETE_PROMOTIONS]: (sid) =>
        this._runGenericDeletionStep(
          'deletePromotions',
          sid,
          S.DELETE_PROMOTIONS
        ),
      [S.DELETE_SPECIFICATIONS]: (sid) =>
        this._runGenericDeletionStep(
          'deleteSpecifications',
          sid,
          S.DELETE_SPECIFICATIONS
        ),
      [S.DELETE_OPTIONS]: (sid) =>
        this._runGenericDeletionStep('deleteOptions', sid, S.DELETE_OPTIONS),
      [S.DELETE_OPTION_CATEGORIES]: (sid) =>
        this._runGenericDeletionStep(
          'deleteOptionCategories',
          sid,
          S.DELETE_OPTION_CATEGORIES
        ),
      [S.DELETE_PRODUCT_RELATED]: (sid) =>
        this._runGenericDeletionStep(
          'deleteProductRelatedEntities',
          sid,
          S.DELETE_PRODUCT_RELATED
        ),
    };
  }

  /**
   * Safe finalize override for deletion flows.
   * Ensures that if any step failed (even if we continued), the final state reflects it.
   */
  async _finalizeSession(sessionId, correlationId) {
    const batches = await this.persistence.getBatchesForSession(sessionId);
    const failedBatch = batches.find((b) => b.status === 'FAILED');

    if (failedBatch) {
      this.logger.warn(
        `Deletion session ${sessionId} completed with partial failures. Marking as FAILED for audit integrity.`,
        { correlationId }
      );
      // Delegate to base implementation which handles detailed error message building
      return await super._finalizeSession(sessionId, correlationId);
    }

    if (await this.persistence.tryFinalizeSession(sessionId)) {
      this.logger.info(
        `Deletion session completed successfully: ${sessionId}`,
        {
          correlationId,
        }
      );

      // Trigger search reindexing to clean up deleted entries from index
      try {
        const session = await this.persistence.getSession(sessionId);
        if (session && session.context && session.context.config) {
          await this.liferay.rest.triggerReindex(session.context.config);
          this.logger.info(
            `Search reindexing triggered after deletion session completed: ${sessionId}`,
            { correlationId }
          );
        }
      } catch (reindexErr) {
        this.logger.warn(
          `Failed to trigger search reindexing after deletion session ${sessionId}`,
          {
            correlationId,
            error: reindexErr.message,
          }
        );
      }

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
      // HARDENING: Match explicit AICA prefix OR stable generated prefixes
      return (
        erc.startsWith('AICA-') ||
        erc.startsWith('PL-GENERAL') ||
        erc.startsWith('PL-PROMO') ||
        erc.startsWith('WH-') ||
        erc.startsWith('PE-')
      );
    };

    try {
      // --- 1. ACCOUNT DISCOVERY (Run first so we can map orders by account ID) ---
      this.logger.info('Crawling accounts for AICA prefix...', { sessionId });
      const { items: allAccounts } = await this.liferay.getAccounts(config);
      manifest.accounts = allAccounts.filter(
        (a) => isAICA(a.externalReferenceCode) || isAICA(a.erc)
      );
      const aicaAccountIds = new Set(manifest.accounts.map((a) => a.id));

      // --- 2. CHANNEL-BASED DISCOVERY (Orders mapped to AICA Accounts) ---
      const activeChannels = [];
      if (isTotal) {
        // SDK getChannels already handles pagination
        const allChannels = await this.liferay.getChannels(config);
        activeChannels.push(...allChannels);
      } else if (channelId) {
        activeChannels.push({ id: channelId });
      }

      for (const chan of activeChannels) {
        try {
          this.logger.info(`Crawling orders for channel ${chan.id}...`, {
            sessionId,
          });
          const { items: chanOrders } = await this.liferay.getOrders(config, {
            filter: `channelId eq ${chan.id}`,
          });
          // Filter orders that belong to our discovered AICA accounts
          const aicaOrders = chanOrders.filter((o) =>
            aicaAccountIds.has(o.accountId)
          );
          manifest.orders.push(...aicaOrders);
        } catch (err) {
          this.logger.warn(`Failed to crawl channel ${chan.id}. skipping.`, {
            sessionId,
            error: err.message,
          });
        }
      }

      // --- 3. CATALOG-BASED DISCOVERY (Products, Specs, Options, Pricing) ---
      const activeCatalogs = [];
      if (isTotal) {
        // SDK getCatalogs already handles pagination
        const allCatalogs = await this.liferay.getCatalogs(config);
        activeCatalogs.push(...allCatalogs);
      } else if (catalogId) {
        activeCatalogs.push({ id: catalogId });
      }

      for (const cat of activeCatalogs) {
        try {
          this.logger.info(`Crawling catalog ${cat.id}...`, { sessionId });

          // Products (SDK handles pagination)
          const { items: catProducts } = await this.liferay.getProducts(
            config,
            { catalogId: cat.id }
          );
          const aicaProducts = catProducts.filter(
            (p) => isAICA(p.externalReferenceCode) || isAICA(p.erc)
          );
          manifest.products.push(...aicaProducts);

          // Pricing (SDK handles pagination)
          const { items: catPrices } = await this.liferay.getPriceLists(
            config,
            { catalogId: cat.id }
          );
          manifest.priceLists.push(
            ...catPrices.filter(
              (p) => isAICA(p.externalReferenceCode) || isAICA(p.erc)
            )
          );

          const { items: catPromos } = await this.liferay.getPromotions(
            config,
            { catalogId: cat.id }
          );
          manifest.promotions.push(
            ...catPromos.filter(
              (p) => isAICA(p.externalReferenceCode) || isAICA(p.erc)
            )
          );
        } catch (err) {
          this.logger.warn(`Failed to crawl catalog ${cat.id}. skipping.`, {
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
        manifest.specifications.push(
          ...specs.filter(
            (s) => isAICA(s.externalReferenceCode) || isAICA(s.erc)
          )
        );

        const opts = await this.liferay.getOptionsByProductIds(
          config,
          productIds
        );
        manifest.options.push(
          ...opts.filter(
            (o) => isAICA(o.externalReferenceCode) || isAICA(o.erc)
          )
        );
      }

      // --- 4. WAREHOUSE DISCOVERY ---
      // SDK getWarehouses already handles pagination
      const { items: warehouses } = await this.liferay.getWarehouses(config);
      manifest.warehouses = warehouses.filter(
        (w) => isAICA(w.externalReferenceCode) || isAICA(w.erc)
      );

      // --- 5. GLOBAL ORPHAN SWEEP (Only in TOTAL mode) ---
      if (isTotal) {
        try {
          // Specs
          const specsRes = await this.liferay.getSpecifications(config);
          const allSpecs = specsRes.items || [];
          manifest.specifications.push(
            ...allSpecs.filter(
              (s) => isAICA(s.externalReferenceCode) || isAICA(s.erc)
            )
          );

          // Options
          const optsRes = await this.liferay.getOptions(config);
          const allOpts = optsRes.items || [];
          manifest.options.push(
            ...allOpts.filter(
              (o) => isAICA(o.externalReferenceCode) || isAICA(o.erc)
            )
          );

          // Groups
          const catsRes = await this.liferay.getOptionCategories(config);
          const allCats = catsRes.items || [];
          manifest.optionCategories.push(
            ...allCats.filter(
              (c) => isAICA(c.externalReferenceCode) || isAICA(c.erc)
            )
          );
        } catch (err) {
          this.logger.warn('Global orphan sweep failed. Continuing...', {
            sessionId,
            error: err.message,
          });
        }
      }

      // --- Final deduplication ---
      manifest.orders = [
        ...new Map(manifest.orders.map((i) => [i.id, i])).values(),
      ];
      manifest.accounts = [
        ...new Map(manifest.accounts.map((i) => [i.id, i])).values(),
      ];
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
      manifest.priceLists = [
        ...new Map(manifest.priceLists.map((i) => [i.id, i])).values(),
      ];
      manifest.promotions = [
        ...new Map(manifest.promotions.map((i) => [i.id, i])).values(),
      ];
      manifest.warehouses = [
        ...new Map(manifest.warehouses.map((i) => [i.id, i])).values(),
      ];

      // Persist to session
      await this.persistence.updateSessionContext(sessionId, { manifest });

      // Emit accurate totals to the UI immediately
      const progressToEmit = [
        { type: 'orders', count: manifest.orders.length },
        { type: 'products', count: manifest.products.length },
        { type: 'accounts', count: manifest.accounts.length },
        { type: 'warehouses', count: manifest.warehouses.length },
        { type: 'specifications', count: manifest.specifications.length },
        { type: 'options', count: manifest.options.length },
        { type: 'priceLists', count: manifest.priceLists.length },
        { type: 'promotions', count: manifest.promotions.length },
      ];

      for (const { type, count } of progressToEmit) {
        this.progress.stepProgress({
          sessionId,
          entityType: type,
          operation: 'delete',
          processedCount: 0,
          totalCount: count,
          correlationId,
        });
      }

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
  async _runGenericDeletionStep(handlerName, sessionId, stepKey = null) {
    const session = await this.persistence.getSession(sessionId);
    if (!session) return;

    const { config, options, channelId, catalogId, manifest } = session.context;
    const { correlationId } = session;

    // Use passed stepKey or fallback to session state
    const stepName = stepKey || session.currentSteps[0];
    if (!stepName) {
      throw new Error(
        `Execution triggered for ${handlerName} but no step key available for session ${sessionId}`
      );
    }

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

    // Special steps that do not rely on item arrays
    if (stepName === S.RESET_CATALOG_CONFIG) {
      hasItems = true;
      totalCount = 1;
    }

    // Only perform real-time checks if no manifest was generated (legacy/manual paths)
    if (!manifest) {
      const check = await this._checkIfEntitiesExist(
        this.liferay,
        config,
        stepName,
        { channelId, catalogId, options }
      );
      totalCount = check.totalCount;
      hasItems = totalCount > 0;
    }

    if (!hasItems) {
      this.logger.info(
        `No items found for ${stepName} in manifest, bypassing.`,
        {
          sessionId,
          correlationId,
        }
      );
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
      { name: S.RESET_CATALOG_CONFIG, type: 'sync' },
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
    ];

    this.persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      sessionName: 'Delete All Commerce Data',
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

    this.progress.sessionStarted({
      sessionId,
      flowType: 'delete',
      correlationId: config.correlationId,
      totalSteps: steps.length,
      totals: {},
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

    return { sessionId, message: 'Deletion started.', summary: {} };
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
            deleteProductSpecifications: S.DELETE_PRODUCT_SPECIFICATIONS,
            deleteProductOptions: S.DELETE_PRODUCT_OPTIONS,
            deletePriceLists: S.DELETE_PRICE_LISTS,
            deletePromotions: S.DELETE_PROMOTIONS,
            deleteSpecifications: S.DELETE_SPECIFICATIONS,
            deleteOptions: S.DELETE_OPTIONS,
            deleteOptionCategories: S.DELETE_OPTION_CATEGORIES,
          };
          return { ...s, name: scopeMap[s.name] || s.name };
        })
      : [];

    // HARDENING: If no explicit scope is provided but we have a channel/catalog,
    // assume a full targeted cleanup for that scope.
    if (steps.length === 0 && (channelId || catalogId)) {
      this.logger.info(
        'No explicit deleteScope provided for targeted deletion. Using default cleanup sequence.',
        { sessionId, channelId, catalogId }
      );
      steps = [
        { name: S.RESET_CATALOG_CONFIG, type: 'sync' },
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
      ];
    }

    if (steps.length === 0)
      return { sessionId, message: 'No entities selected.' };

    const hasPricing = steps.some(
      (s) => s.name === S.DELETE_PRICE_LISTS || s.name === S.DELETE_PROMOTIONS
    );
    if (hasPricing && !steps.some((s) => s.name === S.RESET_CATALOG_CONFIG)) {
      steps.unshift({ name: S.RESET_CATALOG_CONFIG, type: 'sync' });
    }

    // Always add DISCOVER at the start to build the manifest based on selected channel/catalog
    if (!steps.some((s) => s.name === S.DISCOVER)) {
      steps.unshift({ name: S.DISCOVER, type: 'sync' });
    }

    await this.persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      sessionName: 'Delete Selected Commerce Data',
      context: {
        config,
        options,
        channelId,
        catalogId,
        steps,
        generator: 'delete',
      },
    });

    this.progress.sessionStarted({
      sessionId,
      flowType: 'delete',
      correlationId: config.correlationId,
      totalSteps: steps.length,
      totals: {},
    });

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return { sessionId, message: 'Selected deletion started.', summary: {} };
  }
}

module.exports = DeleteCoordinatorService;
