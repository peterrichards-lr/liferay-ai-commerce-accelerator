const BaseWorkflowService = require('./baseWorkflowService.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');
const BATCH_STEP_HANDLERS = require('./batch/batch-steps/index.cjs');

const S = WORKFLOW_STEPS;

/**
 * DeleteCoordinatorService - Orchestrates the safe, dependency-aware deletion of AICA data.
 */
class DeleteCoordinatorService extends BaseWorkflowService {
  constructor(ctx) {
    super(ctx);

    // Register all deletion steps
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
   * Orchestrates the execution of a deletion step.
   */
  async executeStep(sessionId, stepName) {
    try {
      const session = await this.persistence.getSession(sessionId);
      if (!session) return;

      const stepHandler = this.steps[stepName];
      if (!stepHandler) {
        this.logger.warn(`No handler found for deletion step '${stepName}'`, { sessionId });
        return await this.completeSyncStep(sessionId, stepName, 'SYNCHRONOUS');
      }

      // State Gatekeeping: Verify dependencies
      const isReady = await this.verifyStepDependencies(sessionId, stepName, session.context.steps);
      if (!isReady) return;

      this.logger.info(`Executing deletion step: ${stepName}`, { sessionId });

      this.progress.stepStarted({
        sessionId,
        step: stepName,
        entityType: this._normalizeEntityType(stepName),
        operation: 'delete',
        correlationId: session.correlationId
      });

      await stepHandler(sessionId, session);
      
      // If the step was synchronous (like reset-catalog-config), trigger the next step immediately
      const batches = await this.persistence.getBatchesForSession(sessionId);
      const currentBatch = batches.find(b => b.step_key === stepName);
      if (currentBatch && ['SYNCHRONOUS', 'BYPASSED', 'COMPLETED'].includes(currentBatch.status)) {
         await this.ctx.batchCallback._checkSessionCompletion(sessionId, session.correlationId);
      }
    } catch (err) {
      this.logger.error(`Critical error in executeStep for ${stepName}: ${err.message}`, { 
        sessionId,
        stack: err.stack 
      });
      
      // Attempt to mark the step as failed so the workflow doesn't hang forever
      try {
        await this.completeSyncStep(sessionId, stepName, 'FAILED');
        await this.ctx.batchCallback._checkSessionCompletion(sessionId, sessionId);
      } catch (innerErr) {
        this.logger.error(`Failed to fail step ${stepName} after critical error: ${innerErr.message}`);
      }
    }
  }

  /**
   * Advances the deletion workflow sequentially.
   */
  async executeNextStep(sessionId) {
    try {
      const session = await this.persistence.getSession(sessionId);
      if (!session || session.status === 'COMPLETED' || session.status === 'FAILED') return;

      const { correlationId, context } = session;
      const workflowSteps = context.steps || [];
      const batches = await this.persistence.getBatchesForSession(sessionId);

      const isTerminal = (b) => ['COMPLETED', 'FAILED', 'BYPASSED', 'SYNCHRONOUS'].includes(b.status);
      
      // Find the first non-complete step
      for (const stepConfig of workflowSteps) {
        const stepName = typeof stepConfig === 'string' ? stepConfig : stepConfig.name;
        const stepBatches = batches.filter(b => b.step_key === stepName);
        
        const isComplete = stepBatches.length > 0 && stepBatches.every(isTerminal);
        if (isComplete) continue;

        const isRunning = stepBatches.length > 0 && !stepBatches.every(isTerminal);
        if (isRunning) {
          await this.persistence.updateSessionCurrentSteps(sessionId, [stepName]);
          return;
        }

        // Found the next step to run
        await this.persistence.updateSessionCurrentSteps(sessionId, [stepName]);
        await this.executeStep(sessionId, stepName);
        return;
      }

      // If we reach here, all steps are terminal
      await this._finalizeDeletionSession(sessionId, correlationId);
    } catch (err) {
      this.logger.error(`Critical error in executeNextStep for session ${sessionId}: ${err.message}`, { 
        stack: err.stack 
      });
    }
  }

  /**
   * Standardized callback handler for deletion steps.
   */
  async handleBatchCallback(sessionId, batchERC) {
    this.logger.debug(`Batch callback received for deletion session ${sessionId}`, { batchERC });
    return true;
  }

  async _finalizeDeletionSession(sessionId, correlationId) {
    const batches = await this.persistence.getBatchesForSession(sessionId);
    const hasFailures = batches.some(b => b.status === 'FAILED');

    if (hasFailures) {
      if (await this.persistence.tryFailSession(sessionId)) {
        this.progress.sessionFailed({ sessionId, correlationId, error: { message: 'Deletion workflow failed.' } });
      }
    } else if (await this.persistence.tryFinalizeSession(sessionId)) {
      this.logger.info(`Deletion session completed: ${sessionId}`, { correlationId });
      this.progress.sessionCompleted({ sessionId, correlationId });
    }
  }

  /**
   * Generic wrapper for deletion handlers.
   */
  async _runGenericDeletionStep(handlerName, sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, channelId, catalogId } = session.context;
    
    const activeSteps = session.currentSteps;
    const stepName = activeSteps[0]; 

    const { hasItems, totalCount } = await this._checkIfEntitiesExist(
      this.liferay,
      config,
      stepName,
      { channelId, catalogId }
    );

    if (!hasItems) {
      this.logger.info(`No items found for ${stepName}, moving to next`, { sessionId });
      return await this.completeSyncStep(sessionId, stepName, 'BYPASSED');
    }

    const handler = BATCH_STEP_HANDLERS[handlerName];
    const batchERC = createERC(ERC_PREFIX.BATCH);

    // CRITICAL: Persist the batch record before making the Liferay call
    // This ensures the callback worker can correlate the incoming request immediately.
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
        batchERC, // Pass the pre-generated ERC to the handler
        correlationId: session.correlationId,
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
          correlationId: session.correlationId
        });
      } else {
        // Step was processed synchronously (or simulated batch)
        await this.persistence.updateBatch(batchERC, {
          status: 'COMPLETED',
          processedCount: totalCount,
          errorCount: 0
        });

        await this.completeSyncStep(sessionId, stepName, 'COMPLETED', totalCount, totalCount);
      }
    } catch (error) {
      this.logger.error(`Deletion step '${stepName}' failed: ${error.message}`, { sessionId, batchERC });
      await this.persistence.updateBatch(batchERC, { status: 'FAILED' });
      throw error;
    }
  }

  async _checkIfEntitiesExist(liferay, config, stepKey, context) {
    const { channelId, catalogId } = context;

    const checkMap = {
      [S.DELETE_ACCOUNTS]: async () => {
        const res = await liferay.getAccounts(config, { channelId, pageSize: 1, ercPrefix: ERC_PREFIX.ACCOUNT });
        return { totalCount: res.totalCount };
      },
      [S.DELETE_PRODUCTS]: async () => {
        const res = await liferay.getProducts(config, { catalogId, pageSize: 1, ercPrefix: ERC_PREFIX.PRODUCT });
        return { totalCount: res.totalCount };
      },
      [S.DELETE_ORDERS]: async () => {
        try {
          const res = await liferay.getOrders(config, { pageSize: 1, ercPrefix: ERC_PREFIX.ORDER });
          return { totalCount: res.totalCount };
        } catch (err) {
          this.logger.warn(`Failed to check if orders exist for deletion: ${err.message}. Skipping to avoid crash.`, {
            stepKey
          });
          return { totalCount: 0 }; // Return 0 to bypass the step
        }
      },
      [S.DELETE_WAREHOUSES]: async () => {
        const res = await liferay.getWarehouses(config, { pageSize: 1, ercPrefix: ERC_PREFIX.WAREHOUSE });
        return { totalCount: res.totalCount };
      },
      [S.DELETE_PRICE_LISTS]: async () => {
        const res = await liferay.getPriceLists(config, { catalogId, pageSize: 1, ercPrefix: 'AICA-' });
        return { totalCount: res.totalCount };
      },
      [S.DELETE_PROMOTIONS]: async () => {
        const res = await liferay.getPromotions(config, { catalogId, pageSize: 1, ercPrefix: 'AICA-' });
        return { totalCount: res.totalCount };
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
