const BaseGenerator = require('./baseGenerator.cjs');
const {
  createERC,
  resolvePhaseAndMode,
  resolveErrorReference,
} = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

class WarehouseGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);
    this.name = 'WarehouseGenerator';
  }

  async run(config, options, correlationId) {
    const { phase, mode } = resolvePhaseAndMode(options);

    const sessionId = await this.persistence.createSession({
      type: 'warehouse',
      operation: 'generate',
      correlationId,
      context: {
        config,
        options: {
          ...options,
          phase,
          mode,
        },
      },
    });

    this.logger.info('Starting warehouse generation workflow', {
      sessionId,
      correlationId,
      warehouseCount: options.warehouseCount,
    });

    return await this.executeNextStep(sessionId);
  }

  getSteps() {
    return [
      {
        key: S.GENERATE_WAREHOUSE_DATA,
        method: '_runWarehouseDataGenerationStep',
      },
      { key: S.CREATE_WAREHOUSES, method: '_runWarehouseCreationStep' },
    ];
  }

  /**
   * Internal method used by other generators (e.g. ProductGenerator)
   * to perform warehouse creation within an existing session.
   */
  async createWarehouses(sessionId, _session) {
    this.logger.info('Executing embedded warehouse generation sub-flow', {
      sessionId,
    });

    // 1. Generate Data
    await this._runWarehouseDataGenerationStep(sessionId);

    // 2. Create in Liferay
    return await this._runWarehouseCreationStep(sessionId);
  }

  async _runWarehouseDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;

    this.logger.info('Starting warehouse data generation', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      const warehouseDataList = await this.ctx.generation.generateData(
        'warehouse',
        options.warehouseCount || 1,
        config,
        options
      );

      await this.persistence.updateSessionContext(sessionId, {
        warehouseDataList,
      });

      return await this.completeSyncStep(sessionId, S.GENERATE_WAREHOUSE_DATA);
    } catch (error) {
      this.logger.error('Warehouse data generation failed', {
        sessionId,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_WAREHOUSE_DATA,
        status: 'FAILED',
      });
      throw error;
    }
  }

  async _runWarehouseCreationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, warehouseDataList } = session.context;
    const stepKey = S.CREATE_WAREHOUSES;

    this.logger.info('Starting warehouse creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!warehouseDataList || warehouseDataList.length === 0) {
        return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
      }

      // Always use batch for warehouses to keep logic simple
      await this.submitBatch(
        sessionId,
        stepKey,
        'warehouses',
        'generate',
        (erc) =>
          this.liferay.createWarehousesBatch(config, warehouseDataList, {
            externalReferenceCode: erc,
            sessionId,
          }),
        warehouseDataList.length
      );
    } catch (error) {
      const errorReference =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Warehouse creation failed', {
        sessionId,
        error: error.message,
        errorReference,
      });

      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey,
        status: 'FAILED',
      });

      this.ctx.progress.stepFailed(
        {
          sessionId,
          stepKey,
          entityType: 'warehouses',
          error,
        },
        { correlationId: session.correlationId }
      );

      throw error;
    }
  }

  async _verifyWarehouses(sessionId, batchERC) {
    const session = await this.persistence.getSession(sessionId);
    const { config } = session.context;

    this.logger.info('Verifying warehouse creation', {
      sessionId,
      batchERC,
    });

    try {
      const warehouses = await this.liferay.getWarehouses(config);
      this.logger.info('Successfully verified warehouses', {
        count: warehouses.length,
      });
    } catch (error) {
      this.logger.warn('Warehouse verification failed (non-fatal)', {
        sessionId,
        error: error.message,
      });
    }
  }

  async handleBatchCallback(_sessionId, _batchERC) {
    return true;
  }
}

module.exports = WarehouseGenerator;
