const BaseGenerator = require('../generators/baseGenerator.cjs');
const { createERC } = require('../utils/misc.cjs');
const {
  recordReindexFailure,
  recordReindexSuccess,
} = require('../utils/reindexStatus.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');
const { deletionTargetIdOf } = require('../utils/productIdentity.cjs');
const {
  AICA_OWNED,
  ownershipScopeFromId,
  resolveOwnershipScope,
} = require('../utils/ownershipScope.cjs');
const BATCH_STEP_HANDLERS = require('./batch/batch-steps/index.cjs');

const S = WORKFLOW_STEPS;

// Liferay creates a base price list and a base promotion with every catalog.
// The SDK refuses to delete them unless they carry an AICA ERC, so counting
// them as targets would leave a step claiming it deleted more than it did.
const isCatalogOwnedList = (item) =>
  (item.catalogBasePriceList === true ||
    item.catalogBasePriceList === 'true') &&
  !String(item.externalReferenceCode || item.erc || '').startsWith('AICA-');

const isSystemEntity = (item) => item.system === true || item.system === 'true';

/**
 * What a run may target: whatever the ownership scope claims, minus the two
 * kinds of entity Liferay refuses to delete however the run is scoped.
 *
 * The exclusions are not part of the scope. Counting an undeletable entity as
 * a target inflates a step's total and leaves it reporting fewer deletions than
 * it promised, which #657 rightly turns into a FAILED step. _discoverEntities
 * has always applied them; the crawl now does too, so both routes into a
 * manifest agree - and so 'everything' does not sweep up the base price list
 * the moment it is selected. See #850.
 *
 * Crawled DTOs carry `externalReferenceCode`; a few paths carry the shorter
 * `erc`. Either naming the entity is enough.
 */
const targetFilterFor = (scope) => (item) =>
  !isSystemEntity(item) &&
  !isCatalogOwnedList(item) &&
  (scope.owns(item.externalReferenceCode) || scope.owns(item.erc));

// Steps whose targets ARE the entities being removed, so a reported deletion
// count of zero means the data is still there. The association steps are
// deliberately absent: they are handed products and remove the product's
// links, so zero cleared links is a legitimate outcome.
const ENTITY_DELETION_STEPS = new Set([
  S.DELETE_ACCOUNTS,
  S.DELETE_ACCOUNT_GROUPS,
  S.DELETE_ORDERS,
  S.DELETE_OPTIONS,
  S.DELETE_OPTION_CATEGORIES,
  S.DELETE_PRICE_LISTS,
  S.DELETE_PRODUCTS,
  S.DELETE_PROMOTIONS,
  S.DELETE_SPECIFICATIONS,
  S.DELETE_WAREHOUSES,
  S.DELETE_WAREHOUSE_ITEMS,
]);

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
      [S.DELETE_ACCOUNT_GROUPS]: (sid) =>
        this._runGenericDeletionStep(
          'deleteAccountGroups',
          sid,
          S.DELETE_ACCOUNT_GROUPS
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
          recordReindexSuccess({ sessionId });
          this.logger.info(
            `Search reindexing triggered after deletion session completed: ${sessionId}`,
            { correlationId }
          );
        }
      } catch (reindexErr) {
        // Non-fatal, but recorded so /health reports it rather than the
        // failure existing only in a log line. See #618.
        const outcome = recordReindexFailure(reindexErr, { sessionId });

        this.logger.warn(outcome.message, {
          correlationId,
          operation: 'trigger-reindex',
          reindexState: outcome.state,
          error: reindexErr.message,
        });
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

    // A scope object cannot survive the session store, so the run recorded its
    // id and the crawl reads it back. An absent or unrecognised id is the
    // AICA-owned default (#850).
    const scope = ownershipScopeFromId(session.context.ownershipScope);
    const inScope = targetFilterFor(scope);

    this.logger.info(
      `Starting discovery (${isTotal ? 'TOTAL' : 'SELECTED'}, ${scope.label})...`,
      {
        sessionId,
        correlationId,
        ownershipScope: scope.id,
      }
    );

    const manifest = {
      orders: [],
      accounts: [],
      accountGroups: [],
      warehouses: [],
      warehouseItems: [],
      products: [],
      specifications: [],
      options: [],
      optionCategories: [],
      priceLists: [],
      promotions: [],
    };

    try {
      // --- 1. ACCOUNT DISCOVERY (Run first so we can map orders by account ID) ---
      this.logger.info(`Crawling accounts (${scope.label})...`, { sessionId });
      const { items: allAccounts } = await this.liferay.getAccounts(config);
      manifest.accounts = allAccounts.filter(inScope);
      const targetAccountIds = new Set(manifest.accounts.map((a) => a.id));

      // --- 1.5. ACCOUNT GROUP DISCOVERY ---
      this.logger.info(`Crawling account groups (${scope.label})...`, {
        sessionId,
      });
      const { items: allGroups } = await this.liferay.getAccountGroups(config);
      manifest.accountGroups = allGroups.filter(inScope);

      // --- 2. CHANNEL-BASED DISCOVERY (Orders mapped to in-scope accounts) ---
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
          // Filter orders that belong to the accounts discovery kept
          const targetOrders = chanOrders.filter((o) =>
            targetAccountIds.has(o.accountId)
          );
          manifest.orders.push(...targetOrders);
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
          const targetProducts = catProducts.filter(inScope);
          manifest.products.push(...targetProducts);

          // Pricing (SDK handles pagination)
          const { items: catPrices } = await this.liferay.getPriceLists(
            config,
            { catalogId: cat.id }
          );
          manifest.priceLists.push(...catPrices.filter(inScope));

          const { items: catPromos } = await this.liferay.getPromotions(
            config,
            { catalogId: cat.id }
          );
          manifest.promotions.push(...catPromos.filter(inScope));
        } catch (err) {
          this.logger.warn(`Failed to crawl catalog ${cat.id}. skipping.`, {
            sessionId,
            error: err.message,
          });
        }
      }

      // RELATIONAL CRAWL: Fetch Specs/Options linked to discovered products
      if (manifest.products.length > 0) {
        // Crawled Liferay DTOs, so the CPDefinition id is `productId`. Both
        // of the calls below are product-scoped and take that one.
        const productIds = manifest.products
          .map(deletionTargetIdOf)
          .filter(Boolean);

        try {
          const specs = await this.liferay.getSpecificationsByProductIds(
            config,
            productIds
          );
          manifest.specifications.push(...specs.filter(inScope));
        } catch (err) {
          this.logger.warn(
            `Failed to fetch specifications for discovered products: ${err.message}`,
            { sessionId }
          );
        }

        try {
          const opts = await this.liferay.getOptionsByProductIds(
            config,
            productIds
          );
          manifest.options.push(...opts.filter(inScope));
        } catch (err) {
          this.logger.warn(
            `Failed to fetch options for discovered products: ${err.message}`,
            { sessionId }
          );
        }
      }

      // --- 4. WAREHOUSE DISCOVERY ---
      // SDK getWarehouses already handles pagination
      const { items: warehouses } = await this.liferay.getWarehouses(config);
      manifest.warehouses = warehouses.filter(inScope);

      // --- 5. GLOBAL ORPHAN SWEEP (Only in TOTAL mode) ---
      if (isTotal) {
        try {
          // Specs
          const specsRes = await this.liferay.getSpecifications(config);
          const allSpecs = specsRes.items || [];
          manifest.specifications.push(...allSpecs.filter(inScope));

          // Options
          const optsRes = await this.liferay.getOptions(config);
          const allOpts = optsRes.items || [];
          manifest.options.push(...allOpts.filter(inScope));

          // Groups
          const catsRes = await this.liferay.getOptionCategories(config);
          const allCats = catsRes.items || [];
          manifest.optionCategories.push(...allCats.filter(inScope));
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
          manifest.products.map((i) => [deletionTargetIdOf(i), i])
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
      manifest.accountGroups = [
        ...new Map(manifest.accountGroups.map((i) => [i.id, i])).values(),
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
        { type: 'accountGroups', count: manifest.accountGroups.length },
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

    const { config, options, channelId, catalogId, manifest, isTotal } =
      session.context;
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
      // These two detach a product's specification and option ASSOCIATIONS
      // before the definitions themselves are removed, so they iterate
      // products - taking each one's definition id, then
      // getProductSpecifications / getProductOptions with that id. They were
      // handed the definition lists instead, so every id was a specification
      // or option id, every lookup 404'd, and the step reported COMPLETED
      // having detached nothing. It showed up as a run of warnings naming
      // "products" whose ids were consecutive - specifications - or spaced by
      // three or four - options and their values.
      [S.DELETE_PRODUCT_SPECIFICATIONS]: manifest?.products,
      [S.DELETE_OPTIONS]: manifest?.options,
      [S.DELETE_PRODUCT_OPTIONS]: manifest?.products,
      [S.DELETE_PRICE_LISTS]: manifest?.priceLists,
      [S.DELETE_PROMOTIONS]: manifest?.promotions,
      [S.DELETE_ACCOUNT_GROUPS]: manifest?.accountGroups,
      [S.DELETE_OPTION_CATEGORIES]: manifest?.optionCategories,
    };

    let targetItems = manifestMap[stepName];
    let totalCount = targetItems ? targetItems.length : 0;
    let hasItems = totalCount > 0;

    // Special steps that do not rely on item arrays
    if (stepName === S.RESET_CATALOG_CONFIG) {
      hasItems = true;
      totalCount = 1;
    } else if (!hasItems) {
      // An empty manifest entry is not evidence that Liferay holds nothing of
      // this type. It only says the crawl did not recognise anything: a
      // promotion whose ERC came from the model, an option adopted by key from
      // an earlier run, or an entity type the crawl never visits at all. Ask
      // Liferay before declaring the step unnecessary. See #657.
      let discovered;
      try {
        discovered = await this._discoverEntities(stepName, config, {
          channelId,
          catalogId,
          isTotal,
          scope: ownershipScopeFromId(session.context.ownershipScope),
        });
      } catch (error) {
        this.logger.error(
          `Could not establish what '${stepName}' has to delete: ${error.message}. Failing the step - data may remain.`,
          { sessionId, correlationId }
        );
        return await this.completeSyncStep(sessionId, stepName, 'FAILED', 0, 0);
      }

      if (discovered.supported) {
        targetItems = discovered.items;
        totalCount = targetItems.length;
        hasItems = totalCount > 0;

        if (hasItems) {
          this.logger.warn(
            `Manifest recorded nothing for ${stepName}, but discovery found ${totalCount} item(s) in Liferay. Deleting those instead of bypassing.`,
            { sessionId, correlationId }
          );
        } else if (discovered.withheldCount > 0) {
          this.logger.warn(
            `${stepName} left ${discovered.withheldCount} item(s) in place: they are not attributable to AICA and this run is scoped to a channel or catalog.`,
            { sessionId, correlationId }
          );
        }
      }
    }

    if (!hasItems) {
      this.logger.info(
        `No items found for ${stepName} in the manifest or in Liferay, bypassing.`,
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
        // Manifest items when the crawl recorded any, otherwise whatever
        // discovery found for this step
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
        // The simulated (non-native) batch paths delete synchronously and
        // report how many rows they actually removed. Taking totalCount on
        // trust is what let a step that removed nothing - every target
        // withheld by an exclusion rule - report a full success. See #657.
        const reportedCount = Number.isFinite(result?.count)
          ? result.count
          : totalCount;
        const deletedNothing =
          reportedCount === 0 && ENTITY_DELETION_STEPS.has(stepName);

        if (deletedNothing) {
          this.logger.error(
            `Step '${stepName}' removed nothing while ${totalCount} item(s) were targeted. They remain in Liferay.`,
            { sessionId, batchERC, correlationId }
          );
        }

        await this.persistence.updateBatch(batchERC, {
          status: deletedNothing ? 'FAILED' : 'COMPLETED',
          processedCount: reportedCount,
          errorCount: deletedNothing ? totalCount : 0,
        });

        await this.completeSyncStep(
          sessionId,
          stepName,
          deletedNothing ? 'FAILED' : 'COMPLETED',
          reportedCount,
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

  /**
   * Live discovery for a single deletion step.
   *
   * The manifest is a record of what the crawl recognised, not a census of
   * the instance. A promotion whose ERC came from the model, an option
   * adopted by key from an earlier run, and every warehouse item (the crawl
   * never collects them) are all absent from it while present in Liferay.
   * A step whose manifest entry is empty asks here before concluding there
   * is nothing to do. See #657.
   *
   * A total run deletes whatever the query returns. A run scoped to one
   * channel or catalog keeps only what the run's ownership scope can be shown
   * to own, because the option, specification and warehouse-item endpoints
   * have no scope to narrow by and the user asked about one channel, not the
   * instance.
   *
   * That first sentence predates the ownership scope and outranks it: a total
   * run reaches data AICA did not create on any step whose manifest entry came
   * back empty, whichever scope it was started with. So 'AICA-owned' has never
   * been the guarantee on this path that it is on the crawl. Left as it was
   * because narrowing it would leave behind data that runs delete today, but
   * it is the next thing to settle after #850.
   */
  async _discoverEntities(
    stepName,
    config,
    { channelId, catalogId, isTotal, scope = AICA_OWNED }
  ) {
    const products = () => this.liferay.getProducts(config, { catalogId });

    const queries = new Map([
      [
        S.DELETE_ACCOUNTS,
        () => this.liferay.getAccounts(config, { channelId }),
      ],
      [S.DELETE_ACCOUNT_GROUPS, () => this.liferay.getAccountGroups(config)],
      [
        S.DELETE_ORDERS,
        () =>
          this.liferay.getOrders(
            config,
            channelId ? { filter: `channelId eq ${channelId}` } : {}
          ),
      ],
      [S.DELETE_OPTIONS, () => this.liferay.getOptions(config)],
      [
        S.DELETE_OPTION_CATEGORIES,
        () => this.liferay.getOptionCategories(config),
      ],
      [
        S.DELETE_PRICE_LISTS,
        () => this.liferay.getPriceLists(config, { catalogId }),
      ],
      [S.DELETE_PRODUCTS, products],
      // Both association steps iterate products and clear the product's own
      // links, so products are what they need discovering.
      [S.DELETE_PRODUCT_OPTIONS, products],
      [S.DELETE_PRODUCT_SPECIFICATIONS, products],
      [
        S.DELETE_PROMOTIONS,
        () => this.liferay.getPromotions(config, { catalogId }),
      ],
      [S.DELETE_SPECIFICATIONS, () => this.liferay.getSpecifications(config)],
      [S.DELETE_WAREHOUSES, () => this.liferay.getWarehouses(config)],
      // getAllWarehouseItems stops once pageSize items are collected, so this
      // is a best effort. Warehouse deletion, which follows in every flow,
      // takes the remainder with the warehouse.
      [
        S.DELETE_WAREHOUSE_ITEMS,
        () => this.liferay.getAllWarehouseItems(config, { pageSize: 1000 }),
      ],
    ]);

    const query = queries.get(stepName);
    if (!query) {
      return { supported: false, items: [], withheldCount: 0 };
    }

    const inScope = targetFilterFor(scope);

    const result = await query();
    const candidates = (result?.items || []).filter(
      (item) => !isSystemEntity(item) && !isCatalogOwnedList(item)
    );
    const items = isTotal ? candidates : candidates.filter(inScope);

    return {
      supported: true,
      items,
      withheldCount: candidates.length - items.length,
    };
  }

  /**
   * `ownershipScope` is one of the scope objects exported by
   * utils/ownershipScope.cjs. Omitting it means AICA-owned data only, which is
   * what every caller got before #850 and what every caller that does not ask
   * still gets. Passing a string or a boolean throws rather than widening:
   * nothing that arrived as JSON may decide what a delete removes.
   */
  runDeleteAndMonitor(config, options = {}, { ownershipScope } = {}) {
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);
    const { channelId, catalogId } = config;
    const scope = resolveOwnershipScope(ownershipScope);

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
      { name: S.DELETE_ACCOUNT_GROUPS, type: 'sync' },
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
        // The id, not the object: the context is JSON in the session store and
        // the crawl reads it back with ownershipScopeFromId (#850).
        ownershipScope: scope.id,
      },
    });

    this.progress.sessionStarted({
      sessionId,
      flowType: 'delete',
      correlationId: config.correlationId,
      totalSteps: steps.length,
      totals: {},
    });

    // Which scope a run used is not recoverable from the outcome, so the log
    // has to carry it. An operator reading back after an unexpected deletion
    // needs to see whether the run was AICA-owned or everything (#850).
    this.logger.info(
      `Full environment deletion session ${sessionId} started, covering ${scope.label}.`,
      {
        sessionId,
        correlationId: config.correlationId,
        ownershipScope: scope.id,
      }
    );

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return { sessionId, message: 'Deletion started.', summary: {} };
  }

  /**
   * `deleteScope` says which steps run; `ownershipScope` says which entities
   * each of them may touch. Two different questions that both wanted the word
   * scope, so they are named apart (#850).
   */
  async runDeleteSelectedAndMonitor(
    config,
    options = {},
    { channelId, catalogId, deleteScope, ownershipScope } = {}
  ) {
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);
    const scope = resolveOwnershipScope(ownershipScope);

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
            deleteAccountGroups: S.DELETE_ACCOUNT_GROUPS,
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
        { name: S.DELETE_ACCOUNT_GROUPS, type: 'sync' },
        { name: S.DELETE_SPECIFICATIONS, type: 'sync' },
        { name: S.DELETE_OPTIONS, type: 'sync' },
        { name: S.DELETE_OPTION_CATEGORIES, type: 'sync' },
      ];
    }

    if (steps.length === 0)
      return { sessionId, message: 'No entities selected.' };

    const hasPricing = steps.some(
      (s) =>
        s.name === S.DELETE_PRICE_LISTS ||
        s.name === S.DELETE_PROMOTIONS ||
        s.name === S.DELETE_ACCOUNT_GROUPS
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
        ownershipScope: scope.id,
      },
    });

    this.logger.info(
      `Selected deletion session ${sessionId} started, covering ${scope.label}.`,
      {
        sessionId,
        correlationId: config.correlationId,
        ownershipScope: scope.id,
      }
    );

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
