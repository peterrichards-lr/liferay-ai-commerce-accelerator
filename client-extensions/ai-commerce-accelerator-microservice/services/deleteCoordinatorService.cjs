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

    // Register all deletion steps using the generic handler
    this.steps = {
      [S.RESET_CATALOG_CONFIG]: this._runGenericDeletionStep.bind(this, 'resetCatalogConfiguration'),
      [S.DELETE_ORDERS]: this._runGenericDeletionStep.bind(this, 'deleteOrders'),
      [S.DELETE_WAREHOUSES]: this._runGenericDeletionStep.bind(this, 'deleteWarehouses'),
      [S.DELETE_WAREHOUSE_ITEMS]: this._runGenericDeletionStep.bind(this, 'deleteWarehouseItems'),
      [S.DELETE_ACCOUNTS]: this._runGenericDeletionStep.bind(this, 'deleteAccounts'),
      [S.DELETE_PRODUCTS]: this._runGenericDeletionStep.bind(this, 'deleteProducts'),
      [S.DELETE_PRODUCT_OPTIONS]: this._runGenericDeletionStep.bind(this, 'deleteProductOptions'),
      [S.DELETE_PRODUCT_SPECIFICATIONS]: this._runGenericDeletionStep.bind(this, 'deleteProductSpecifications'),
      [S.DELETE_PRICE_LISTS]: this._runGenericDeletionStep.bind(this, 'deletePriceLists'),
      [S.DELETE_PROMOTIONS]: this._runGenericDeletionStep.bind(this, 'deletePromotions'),
      [S.DELETE_SPECIFICATIONS]: this._runGenericDeletionStep.bind(this, 'deleteSpecifications'),
      [S.DELETE_OPTIONS]: this._runGenericDeletionStep.bind(this, 'deleteOptions'),
      [S.DELETE_OPTION_CATEGORIES]: this._runGenericDeletionStep.bind(this, 'deleteOptionCategories'),
      [S.DELETE_PRODUCT_RELATED]: this._runGenericDeletionStep.bind(this, 'deleteProductRelatedEntities'),
    };
  }

  /**
   * Safe finalize override for deletion flows.
   */
  async _finalizeSession(sessionId, correlationId) {
    if (await this.persistence.tryFinalizeSession(sessionId)) {
      this.logger.info(`Deletion session completed: ${sessionId}`, { correlationId });
      this.progress.sessionCompleted({ sessionId, correlationId });
    }
  }

  /**
   * Generic wrapper for deletion handlers that ensures batch records are created correctly.
   */
  async _runGenericDeletionStep(handlerName, sessionId) {
    const session = await this.persistence.getSession(sessionId);
    if (!session) return;

    const { config, options, channelId, catalogId } = session.context;
    const { correlationId } = session;
    
    // Find the current step name from the session context (we only have one active step in delete flow)
    const stepName = session.currentSteps[0]; 
    if (!stepName) {
      throw new Error(`Execution triggered for ${handlerName} but no current step found in session ${sessionId}`);
    }

    const { hasItems, totalCount } = await this._checkIfEntitiesExist(
      this.liferay,
      config,
      stepName,
      { channelId, catalogId }
    );

    if (!hasItems) {
      this.logger.info(`No items found for ${stepName}, bypassing.`, { sessionId, correlationId });
      return await this.completeSyncStep(sessionId, stepName, 'BYPASSED');
    }

    const handler = BATCH_STEP_HANDLERS[handlerName];
    const batchERC = createERC(ERC_PREFIX.BATCH);

    // CRITICAL: Persist the batch record before making the Liferay call
    await this.persistence.createBatch({
      erc: batchERC,
      sessionId,
      stepKey: stepName,
      status: 'PREPARED',
      totalCount: totalCount
    });

    try {
      const result = await handler(this.ctx, {
        config,
        options,
        sessionId,
        channelId,
        catalogId,
        totalCount,
        batchERC,
        correlationId,
      });

      if (result && result.batchRefs && result.batchRefs.length > 0) {
        // Native batch was triggered, update status to SUBMITTED
        const firstBatchId = result.batchRefs[0].taskId;
        await this.persistence.updateBatch(batchERC, {
          status: 'SUBMITTED',
          downstreamBatchId: firstBatchId
        });

        this.progress.batchStarted({
          sessionId,
          batchERC,
          batchId: firstBatchId,
          totalItems: totalCount,
          entityType: this._normalizeEntityType(stepName),
          operation: 'delete',
          correlationId
        });
      } else {
        // Step was processed synchronously (like reset-catalog-config or simulated batch)
        await this.persistence.updateBatch(batchERC, {
          status: 'COMPLETED',
          processedCount: totalCount,
          errorCount: 0
        });

        await this.completeSyncStep(sessionId, stepName, 'COMPLETED', totalCount, totalCount);
      }
    } catch (error) {
      this.logger.error(`Deletion step '${stepName}' failed: ${error.message}`, { sessionId, batchERC, correlationId });
      await this.persistence.updateBatch(batchERC, { status: 'FAILED' });
      // We re-throw to ensure the orchestrator handles the failure
      throw error;
    }
  }

  async _checkIfEntitiesExist(liferay, config, stepKey, context) {
    const { channelId, catalogId } = context;
    const BRUTE_FORCE_PAGE_SIZE = 1000;

    const checkMap = {
      [S.DELETE_ACCOUNTS]: async () => {
        // Fetch all items and filter in JS memory
        const res = await liferay.getAccounts(config, { channelId, pageSize: BRUTE_FORCE_PAGE_SIZE });
        const filtered = res.items.filter(it => it.externalReferenceCode?.startsWith(ERC_PREFIX.ACCOUNT));
        return { totalCount: filtered.length };
      },
      [S.DELETE_PRODUCTS]: async () => {
        const res = await liferay.getProducts(config, { catalogId, pageSize: BRUTE_FORCE_PAGE_SIZE });
        const filtered = res.items.filter(it => it.externalReferenceCode?.startsWith(ERC_PREFIX.PRODUCT));
        return { totalCount: filtered.length };
      },
      [S.DELETE_ORDERS]: async () => {
        try {
          const res = await liferay.getOrders(config, { pageSize: BRUTE_FORCE_PAGE_SIZE });
          const filtered = res.items.filter(it => it.externalReferenceCode?.startsWith(ERC_PREFIX.ORDER));
          return { totalCount: filtered.length };
        } catch (err) {
          this.logger.warn(`Failed to check if orders exist for deletion: ${err.message}. Skipping to avoid crash.`, {
            stepKey
          });
          return { totalCount: 0 };
        }
      },
      [S.DELETE_WAREHOUSES]: async () => {
        const res = await liferay.getWarehouses(config, { pageSize: BRUTE_FORCE_PAGE_SIZE });
        const filtered = res.items.filter(it => it.externalReferenceCode?.startsWith(ERC_PREFIX.WAREHOUSE));
        return { totalCount: filtered.length };
      },
      [S.DELETE_PRICE_LISTS]: async () => {
        const res = await liferay.getPriceLists(config, { catalogId, pageSize: BRUTE_FORCE_PAGE_SIZE });
        const filtered = res.items.filter(it => it.externalReferenceCode?.startsWith('AICA-'));
        return { totalCount: filtered.length };
      },
      [S.DELETE_PROMOTIONS]: async () => {
        const res = await liferay.getPromotions(config, { catalogId, pageSize: BRUTE_FORCE_PAGE_SIZE });
        const filtered = res.items.filter(it => it.externalReferenceCode?.startsWith('AICA-'));
        return { totalCount: filtered.length };
      },
      [S.RESET_CATALOG_CONFIG]: async () => ({ hasItems: true, totalCount: 1 }),
    };

    if (!checkMap[stepKey]) return { hasItems: true, totalCount: 0 };

    const result = await checkMap[stepKey]();
    return {
      hasItems: (result.totalCount || 0) > 0 || !!result.hasItems,
      totalCount: result.totalCount || 0
    };
  }

  runDeleteAndMonitor(config, options = {}) {
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);
    const { channelId, catalogId } = config;

    const steps = [
      { name: S.RESET_CATALOG_CONFIG, type: 'sync' },
      { name: S.DELETE_ORDERS, type: 'sync' },
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

    this.ctx.batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    return { sessionId, message: 'Deletion started.' };
  }

  async runDeleteSelectedAndMonitor(config, options = {}, { channelId, catalogId, deleteScope }) {
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

    let steps = Array.isArray(deleteScope) ? deleteScope.map(s => {
       const scopeMap = {
          'resetCatalogConfiguration': S.RESET_CATALOG_CONFIG,
          'deleteOrders': S.DELETE_ORDERS,
          'deleteWarehouses': S.DELETE_WAREHOUSES,
          'deleteAccounts': S.DELETE_ACCOUNTS,
          'deleteProducts': S.DELETE_PRODUCTS,
          'deletePriceLists': S.DELETE_PRICE_LISTS,
          'deletePromotions': S.DELETE_PROMOTIONS,
       };
       return { ...s, name: scopeMap[s.name] || s.name };
    }) : [];

    if (steps.length === 0) return { sessionId, message: 'No entities selected.' };

    const hasPricing = steps.some(s => s.name === S.DELETE_PRICE_LISTS || s.name === S.DELETE_PROMOTIONS);
    if (hasPricing && !steps.some(s => s.name === S.RESET_CATALOG_CONFIG)) {
      steps.unshift({ name: S.RESET_CATALOG_CONFIG, type: 'sync' });
    }

    await this.persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: { config, options, channelId, catalogId, steps },
    });

    this.ctx.batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    return { sessionId, message: 'Selected deletion started.' };
  }
}

module.exports = DeleteCoordinatorService;
