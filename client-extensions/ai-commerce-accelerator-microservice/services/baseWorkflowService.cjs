const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

/**
 * BaseWorkflowService - The foundational abstract class for all workflow-driven services.
 * It manages the connection to core infrastructure (Persistence, Liferay, Progress, Logger)
 * and provides standardized methods for batch and session lifecycle management.
 */
class BaseWorkflowService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  // --- Infrastructure Accessors ---

  get logger() { return this.ctx.logger; }
  get liferay() { return this.ctx.liferay; }
  get persistence() { return this.ctx.persistence; }
  get progress() { return this.ctx.progress; }

  // --- Step Validation ---

  /**
   * Validates if a step key is registered in the WORKFLOW_STEPS enum.
   */
  isValidStep(stepKey) {
    return Object.values(WORKFLOW_STEPS).includes(stepKey);
  }

  /**
   * Throws an error if the step key is not registered.
   */
  _ensureValidStep(stepKey) {
    if (!this.isValidStep(stepKey)) {
      throw new Error(`Unregistered workflow step key: '${stepKey}'. Please add it to WORKFLOW_STEPS in constants.cjs`);
    }
  }

  // --- Dependency & State Gatekeeping ---

  /**
   * Verifies if all upstream dependencies for a specific step are in a terminal state.
   */
  async verifyStepDependencies(sessionId, stepName, workflowSteps) {
    const stepConfig = workflowSteps.find(s => (typeof s === 'string' ? s === stepName : s.name === stepName));
    
    if (stepConfig && stepConfig.dependsOn) {
      const dependencies = Array.isArray(stepConfig.dependsOn) ? stepConfig.dependsOn : [stepConfig.dependsOn];
      for (const dep of dependencies) {
        const isReady = await this.persistence.verifyDependencyReady(sessionId, dep);
        if (!isReady) {
          this.logger.warn(`Dependency '${dep}' not ready for step '${stepName}'. Pausing execution.`, { sessionId });
          return false;
        }
      }
    }
    return true;
  }

  // --- Lifecycle Management (Batch & Sync) ---

  /**
   * Standardized helper to start a Liferay batch submission.
   * Handles the 'PREPARED' -> 'SUBMITTED' lifecycle and WebSocket notifications.
   */
  async submitBatch(sessionId, stepKey, entityType, operation, submitFn, itemsCount) {
    this._ensureValidStep(stepKey);
    const session = await this.persistence.getSession(sessionId);
    const batchERC = createERC(ERC_PREFIX.BATCH);

    await this.persistence.createBatch({
      erc: batchERC,
      sessionId,
      stepKey,
      status: 'PREPARED',
      totalCount: itemsCount
    });

    try {
      const result = await submitFn(batchERC);

      if (result && result.batchId) {
        await this.persistence.updateBatch(batchERC, {
          status: 'SUBMITTED',
          downstreamBatchId: result.batchId
        });

        this.progress.batchStarted({
          sessionId,
          batchERC,
          batchId: result.batchId,
          totalItems: itemsCount,
          entityType,
          operation,
          correlationId: session.correlationId
        });

        return { batchERC, batchId: result.batchId };
      } else {
        throw new Error(`Failed to obtain batchId from Liferay for step '${stepKey}'`);
      }
    } catch (error) {
      this.logger.error(`Batch submission failed for step '${stepKey}': ${error.message}`, { sessionId, batchERC });
      await this.persistence.updateBatch(batchERC, { status: 'FAILED' });
      throw error;
    }
  }

  /**
   * Standardized helper for synchronous or bypassed steps.
   * Consistently marks the step as finished and broadcasts progress.
   */
  async completeSyncStep(sessionId, stepKey, status = 'SYNCHRONOUS', processedCount = 0, totalCount = 0) {
    this._ensureValidStep(stepKey);
    const session = await this.persistence.getSession(sessionId);
    const erc = createERC(ERC_PREFIX.BATCH);
    
    const batch = await this.persistence.createBatch({
      erc,
      sessionId,
      stepKey,
      status,
      processedCount,
      totalCount
    });

    if (['SYNCHRONOUS', 'COMPLETED', 'BYPASSED'].includes(status)) {
       this.progress.stepCompleted({
          sessionId,
          step: stepKey,
          entityType: this._normalizeEntityType(stepKey),
          operation: session.flow_type,
          totalCount,
          correlationId: session.correlationId
       });
    }

    return batch;
  }

  // --- Normalization & Mapping ---

  /**
   * Normalizes an array of items to ensure they have consistent id and erc properties.
   */
  _normalize(items) {
    if (!Array.isArray(items)) return [];
    return items.map(item => ({
      id: item.id || item.productId || item.accountId || item.warehouseId || item.orderId,
      erc: item.externalReferenceCode || item.erc,
      ...item
    }));
  }

  /**
   * Maps internal step keys to standardized entity types for UI progress bars.
   */
  _normalizeEntityType(stepKey) {
    const S = WORKFLOW_STEPS;
    const map = {
      DISCOVER: 'products',
      // Generation
      [S.GENERATE_PRODUCT_DATA]: 'products',
      [S.CREATE_PRODUCTS]: 'products',
      [S.RESOLVE_PRODUCT_IDS]: 'products',
      [S.CREATE_PRODUCT_SKUS]: 'products',
      [S.RESOLVE_SKU_IDS]: 'products',
      [S.LINK_PRODUCT_OPTIONS]: 'options',
      [S.ATTACH_IMAGES]: 'images',
      [S.ATTACH_PDFS]: 'pdfs',
      [S.UPDATE_INVENTORY]: 'products',
      [S.GENERATE_WAREHOUSE_DATA]: 'warehouses',
      [S.CREATE_WAREHOUSES]: 'warehouses',
      [S.RESOLVE_WAREHOUSE_IDS]: 'warehouses',
      [S.GENERATE_PRICE_LISTS]: 'products',
      [S.UPDATE_CATALOG_CONFIG]: 'products',
      [S.GENERATE_BULK_PRICING]: 'products',
      [S.GENERATE_TIER_PRICING]: 'products',
      [S.LOAD_COUNTRIES]: 'accounts',
      [S.GENERATE_ACCOUNT_DATA]: 'accounts',
      [S.CREATE_ACCOUNTS]: 'accounts',
      [S.RESOLVE_ACCOUNT_IDS]: 'accounts',
      [S.CREATE_POSTAL_ADDRESSES]: 'accounts',
      [S.SET_ADDRESS_DEFAULTS]: 'accounts',
      [S.GENERATE_ORDER_DATA]: 'orders',
      [S.CREATE_ORDERS]: 'orders',

      // Deletion
      [S.RESET_CATALOG_CONFIG]: 'products',
      [S.DELETE_ORDERS]: 'orders',
      [S.DELETE_WAREHOUSES]: 'warehouses',
      [S.DELETE_WAREHOUSE_ITEMS]: 'warehouses',
      [S.DELETE_ACCOUNTS]: 'accounts',
      [S.DELETE_PRODUCTS]: 'products',
      [S.DELETE_PRODUCT_OPTIONS]: 'options',
      [S.DELETE_PRODUCT_SPECIFICATIONS]: 'specifications',
      [S.DELETE_PRICE_LISTS]: 'products',
      [S.DELETE_PROMOTIONS]: 'products',
      [S.DELETE_SPECIFICATIONS]: 'specifications',
      [S.DELETE_OPTIONS]: 'options',
      [S.DELETE_OPTION_CATEGORIES]: 'options',
      [S.DELETE_PRODUCT_RELATED]: 'products',
    };
    return map[stepKey] || stepKey;
  }
}

module.exports = BaseWorkflowService;
