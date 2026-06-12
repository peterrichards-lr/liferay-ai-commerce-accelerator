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

  get logger() {
    return this.ctx.logger;
  }
  get liferay() {
    return this.ctx.liferay;
  }
  get persistence() {
    return this.ctx.persistence;
  }
  get progress() {
    return this.ctx.progress;
  }

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
      throw new Error(
        `Unregistered workflow step key: '${stepKey}'. Please add it to WORKFLOW_STEPS in constants.cjs` // pragma: allowlist secret
      );
    }
  }

  // --- Dependency & State Gatekeeping ---

  /**
   * Verifies if all upstream dependencies for a specific step are in a terminal state.
   */
  async verifyStepDependencies(sessionId, stepName, workflowSteps) {
    const stepConfig = workflowSteps.find((s) =>
      typeof s === 'string' ? s === stepName : s.name === stepName
    );

    if (stepConfig && stepConfig.dependsOn) {
      const dependencies = Array.isArray(stepConfig.dependsOn)
        ? stepConfig.dependsOn
        : [stepConfig.dependsOn];
      for (const dep of dependencies) {
        const isReady = await this.persistence.verifyDependencyReady(
          sessionId,
          dep
        );
        if (!isReady) {
          this.logger.warn(
            `Dependency '${dep}' not ready for step '${stepName}'. Pausing execution.`,
            { sessionId }
          );
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
  async submitBatch(
    sessionId,
    stepKey,
    entityType,
    operation,
    submitFn,
    itemsCount
  ) {
    this._ensureValidStep(stepKey);
    const session = await this.persistence.getSession(sessionId);
    const batchERC = createERC(ERC_PREFIX.BATCH);

    await this.persistence.createBatch({
      erc: batchERC,
      sessionId,
      stepKey,
      status: 'PREPARED',
      totalCount: itemsCount,
    });

    try {
      const result = await submitFn(batchERC, session);

      const isAlreadyCompleted =
        result && result.status && result.status.toLowerCase() === 'completed';

      if (isAlreadyCompleted || (result && result.batchId)) {
        const batchId = result.batchId || 'simulated-batch';

        await this.persistence.updateBatch(batchERC, {
          status: isAlreadyCompleted ? 'COMPLETED' : 'SUBMITTED',
          downstreamBatchId: batchId,
          ...(isAlreadyCompleted && { completedCount: itemsCount }),
        });

        this.progress.batchStarted({
          sessionId,
          batchERC,
          batchId: batchId,
          totalItems: itemsCount,
          entityType,
          operation,
          correlationId: session.correlationId,
        });

        if (isAlreadyCompleted) {
          this.progress.batchCompleted({
            sessionId,
            batchERC,
            correlationId: session.correlationId,
          });
          // Since we are in the SDK, we don't have direct access to batchCallback,
          // but we can just use completeSyncStep to force the advancement!
          setTimeout(() => {
            this.completeSyncStep(sessionId, stepKey, 'COMPLETED')
              .then(() => {
                if (this.ctx.batchCallback) {
                  this.ctx.batchCallback._checkSessionCompletion(
                    sessionId,
                    session.correlationId
                  );
                }
              })
              .catch((e) =>
                this.logger.error(
                  `Failed to auto-advance simulated batch: ${e.message}`
                )
              );
          }, 500);
        }

        return { batchERC, batchId: batchId };
      } else {
        throw new Error(
          `Failed to obtain batchId from Liferay for step '${stepKey}'`
        );
      }
    } catch (error) {
      this.logger.error(
        `Batch submission failed for step '${stepKey}': ${error.message}`,
        { sessionId, batchERC }
      );
      await this.persistence.updateBatch(batchERC, { status: 'FAILED' });
      throw error;
    }
  }

  // --- Normalization & Mapping ---

  /**
   * Normalizes an array of items to ensure they have consistent id and erc properties.
   */
  _normalize(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      id:
        item.id ||
        item.productId ||
        item.accountId ||
        item.warehouseId ||
        item.orderId,
      erc: item.externalReferenceCode || item.erc,
      ...item,
    }));
  }

  /**
   * Maps internal step keys to standardized entity types for UI progress bars.
   */
  _normalizeEntityType(stepKey) {
    const S = WORKFLOW_STEPS;
    const map = {
      // Structural/Container Mappings (for session events)
      'subflow-products': 'products',
      'subflow-accounts': 'accounts',
      'subflow-orders': 'orders',

      // Primary Entity Creation (Counts directly against requested amounts)
      [S.CREATE_PRODUCTS]: 'products',
      [S.CREATE_ACCOUNTS]: 'accounts',
      [S.CREATE_ORDERS]: 'orders',
      [S.CREATE_WAREHOUSES]: 'warehouses',
      [S.GENERATE_PRICE_LISTS]: 'priceLists',
      [S.GENERATE_BULK_PRICING]: 'priceLists',
      [S.GENERATE_TIER_PRICING]: 'priceLists',
      [S.ATTACH_IMAGES]: 'images',
      [S.ATTACH_PDFS]: 'pdfs',

      // Auxiliary/Secondary Steps (Map to separate entities or leave as is)
      [S.GENERATE_PRODUCT_DATA]: 'data-generation',
      [S.RESOLVE_PRODUCT_IDS]: 'metadata',
      [S.CREATE_PRODUCT_SKUS]: 'skus',
      [S.RESOLVE_SKU_IDS]: 'metadata',
      [S.LINK_PRODUCT_OPTIONS]: 'options',
      [S.SYNC_DELAY_PRICING]: 'sync-delay',
      [S.SYNC_DELAY_MEDIA]: 'sync-delay',
      [S.SYNC_DELAY_ORDERS]: 'sync-delay',
      [S.UPDATE_INVENTORY]: 'inventory',
      [S.UPDATE_CATALOG_CONFIG]: 'config',

      [S.LOAD_COUNTRIES]: 'metadata',
      [S.GENERATE_ACCOUNT_DATA]: 'data-generation',
      [S.RESOLVE_ACCOUNT_IDS]: 'metadata',
      [S.CREATE_POSTAL_ADDRESSES]: 'addresses',
      [S.SET_ADDRESS_DEFAULTS]: 'addresses',

      [S.GENERATE_ORDER_DATA]: 'data-generation',

      [S.GENERATE_WAREHOUSE_DATA]: 'data-generation',
      [S.RESOLVE_WAREHOUSE_IDS]: 'metadata',
      [S.LINK_WAREHOUSE_CHANNELS]: 'warehouses',

      // Deletion (Map back to primary entities so we see progress on the same bars)
      [S.DELETE_PRODUCTS]: 'products',
      [S.DELETE_ACCOUNTS]: 'accounts',
      [S.DELETE_ORDERS]: 'orders',
      [S.DELETE_WAREHOUSES]: 'warehouses',
      [S.DELETE_WAREHOUSE_ITEMS]: 'warehouses',
      [S.DELETE_PRODUCT_SPECIFICATIONS]: 'specifications',
      [S.DELETE_PRODUCT_OPTIONS]: 'options',
      [S.DELETE_SPECIFICATIONS]: 'specifications',
      [S.DELETE_OPTIONS]: 'options',
      [S.DELETE_OPTION_CATEGORIES]: 'options',
      [S.DELETE_PRICE_LISTS]: 'priceLists',
      [S.DELETE_PROMOTIONS]: 'promotions',
      [S.RESET_CATALOG_CONFIG]: 'products',
    };

    // If the step matches a known category, return it for grouping.
    // Otherwise, return the step key itself so the UI can display its specific name.
    return map[stepKey] || stepKey;
  }
}

module.exports = BaseWorkflowService;
