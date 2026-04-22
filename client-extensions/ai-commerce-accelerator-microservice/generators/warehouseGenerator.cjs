const BaseGenerator = require('./baseGenerator.cjs');
const { createERC, toI18n } = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

/**
 * WarehouseGenerator - Specialized orchestrator for warehouse generation.
 */
class WarehouseGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    this.steps = {
      [S.GENERATE_WAREHOUSE_DATA]:
        this._runWarehouseDataGenerationStep.bind(this),
      [S.CREATE_WAREHOUSES]: this._runWarehouseCreationStep.bind(this),
    };
  }

  /**
   * Standalone entry point for warehouse generation.
   */
  async runWorkflow(config, options) {
    const sessionId = options.sessionId || createERC(ERC_PREFIX.BATCH_SESSION);
    options.sessionId = sessionId;

    const steps = [
      { name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' },
      { name: S.CREATE_WAREHOUSES, type: 'sync' },
    ];

    await this.persistence.createSession({
      sessionId,
      flowType: 'warehouses',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: {
        config,
        options,
        steps,
        generator: 'warehouse',
      },
    });

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return {
      sessionId,
      message: 'Warehouse generation workflow started.',
    };
  }

  /**
   * Internal method used by other generators (e.g. ProductGenerator)
   * to perform warehouse creation within an existing session.
   */
  async createWarehouses(sessionId, session) {
    const { config, options } = session.context;

    this.logger.info('Executing embedded warehouse generation sub-flow', {
      sessionId,
    });

    // 1. Generate Data
    const data = await this._runWarehouseDataGenerationStep(sessionId);

    // 2. Create in Liferay
    return await this._runWarehouseCreationStep(sessionId);
  }

  async _runWarehouseDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;

    this.logger.info('Starting warehouse data generation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      this.validateConfig(config);
      // Fallback for warehouse count if embedded in product flow
      const count = options.warehouseCount || 5;

      const warehouseDataList = await this.ctx.generation.generateData(
        'warehouse',
        count,
        config,
        options
      );

      const normalizedWarehouseDataList = warehouseDataList.map((data) =>
        this._normalizeWarehouseData(data, config)
      );

      // Targeted update: Only add the new data to the existing context
      await this.persistence.updateSessionContext(sessionId, {
        warehouseDataList: normalizedWarehouseDataList,
      });

      await this.completeSyncStep(
        sessionId,
        S.GENERATE_WAREHOUSE_DATA,
        'SYNCHRONOUS',
        normalizedWarehouseDataList.length,
        count
      );

      return normalizedWarehouseDataList;
    } catch (error) {
      this.logger.error('Failed execution of generate-warehouse-data step', {
        sessionId,
        correlationId: session.correlationId,
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
    const { config, options, warehouseDataList } = session.context;
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
      const result = await this.submitBatch(
        sessionId,
        stepKey,
        'warehouses',
        'generate',
        (erc) =>
          this.liferay.createWarehousesBatch(config, warehouseDataList, {
            externalReferenceCode: erc,
            sessionId,
            session,
          }),
        warehouseDataList.length
      );

      return warehouseDataList;
    } catch (error) {
      this.logger.error(`Failed execution of ${stepKey} step`, {
        sessionId,
        correlationId: session.correlationId,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: stepKey,
        status: 'FAILED',
      });
      throw error;
    }
  }

  _normalizeWarehouseData(warehouseData, config) {
    const name = toI18n(warehouseData.name, config.localeCode);
    const description = toI18n(warehouseData.description, config.localeCode);
    const countryISOCode = warehouseData.country?.substring(0, 2).toUpperCase();
    const regionISOCode = warehouseData.region?.substring(0, 2).toUpperCase();
    const { country, region, ...rest } = warehouseData;

    return {
      ...rest,
      name,
      description,
      countryISOCode,
      regionISOCode,
      latitude: Math.random() * 180 - 90,
      longitude: Math.random() * 360 - 180,
      externalReferenceCode:
        rest.externalReferenceCode || createERC(ERC_PREFIX.WAREHOUSE),
    };
  }

  validateConfig(config) {
    if (!config.catalogId) throw new Error('catalogId is required');
  }

  async handleBatchCallback(sessionId, batchERC) {
    return true;
  }
}

module.exports = WarehouseGenerator;
