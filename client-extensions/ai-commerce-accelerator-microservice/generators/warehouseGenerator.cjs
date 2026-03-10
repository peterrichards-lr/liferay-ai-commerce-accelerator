const BaseGenerator = require('./baseGenerator.cjs');
const { createERC, toI18n, resolvePhaseAndMode } = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

/**
 * WarehouseGenerator - Specialized orchestrator for warehouse generation.
 */
class WarehouseGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    this.steps = {
      [S.GENERATE_WAREHOUSE_DATA]: this._runWarehouseDataGenerationStep.bind(this),
      [S.CREATE_WAREHOUSES]: this._runWarehouseCreationStep.bind(this),
    };
  }

  async createWarehouses(config, options) {
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
      },
    });

    if (options.stepKey) {
       await this.executeStep(sessionId, S.GENERATE_WAREHOUSE_DATA);
       return await this.executeStep(sessionId, S.CREATE_WAREHOUSES);
    }

    this.ctx.batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    return {
      sessionId,
      message: 'Warehouse generation workflow started.',
    };
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
      await this.validateOptions(config, options);

      const warehouseDataList = await this.ctx.generation.generate(
        'warehouse',
        options.warehouseCount,
        config,
        options
      );

      const normalizedWarehouseDataList = warehouseDataList.map((data) =>
        this._normalizeWarehouseData(data, config)
      );

      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        warehouseDataList: normalizedWarehouseDataList,
      });

      await this.completeSyncStep(sessionId, S.GENERATE_WAREHOUSE_DATA, 'SYNCHRONOUS', normalizedWarehouseDataList.length, options.warehouseCount);
      
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
    const stepKey = options.stepKey || S.CREATE_WAREHOUSES;

    this.logger.info('Starting warehouse creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!warehouseDataList || warehouseDataList.length === 0) {
        return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
      }

      const useBatch = warehouseDataList.length > 1;

      if (useBatch) {
        if (options.dryRun) {
          return await this.completeSyncStep(sessionId, stepKey, 'SYNCHRONOUS', warehouseDataList.length, warehouseDataList.length);
        }

        const result = await this.submitBatch(
          sessionId,
          stepKey,
          'warehouses',
          'generate',
          (erc) => this.liferay.createWarehousesBatch(config, warehouseDataList, {
            externalReferenceCode: erc,
          }),
          warehouseDataList.length
        );
        
        return warehouseDataList;
      } else {
        const createdWarehouses = [];
        const errors = [];
        const batchId = `warehouses-individual-${Date.now()}`;
        const batchERC = createERC(ERC_PREFIX.WAREHOUSE_BATCH);

        this.progress.batchStarted({
          batchId,
          batchERC,
          entityType: 'warehouses',
          totalItems: warehouseDataList.length,
          operation: 'generate',
          sessionId,
          correlationId: session.correlationId,
        });

        for (let i = 0; i < warehouseDataList.length; i++) {
          const warehouse = warehouseDataList[i];
          try {
            if (options.dryRun) {
              createdWarehouses.push(warehouse);
              continue;
            }

            const created = await this.liferay.createWarehouse(config, warehouse);
            createdWarehouses.push(created);

            this.progress.batchProgress({
              batchId,
              entityType: 'warehouses',
              completedCount: i + 1,
              totalItems: warehouseDataList.length,
              sessionId,
              correlationId: session.correlationId,
            });
          } catch (err) {
            errors.push({ index: i, error: err.message });
          }
        }

        this.progress.batchCompleted({
          batchId,
          entityType: 'warehouses',
          successCount: createdWarehouses.length,
          failureCount: errors.length,
          errors,
          operation: 'generate',
          sessionId,
          correlationId: session.correlationId,
        });

        await this.completeSyncStep(sessionId, stepKey, 'SYNCHRONOUS', createdWarehouses.length, warehouseDataList.length);
        return createdWarehouses;
      }
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

  async validateOptions(config, options) {
    if (!options.warehouseCount || options.warehouseCount <= 0) {
      throw new Error('warehouseCount must be greater than 0');
    }
  }

  async handleBatchCallback(sessionId, batchERC) {
    this.logger.debug(`Batch callback received for warehouse generation session ${sessionId}`, { batchERC });
    return true;
  }
}

module.exports = WarehouseGenerator;
