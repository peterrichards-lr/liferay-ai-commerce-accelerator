const {
  createERC,
  toI18n,
  resolvePhaseAndMode,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class WarehouseGenerator {
  constructor(ctx) {
    this.ctx = ctx;
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

  async createWarehouses(config, options) {
    const { logger, ai, mockData, progress, liferay, persistence } =
      this.ctx;
    const { warehouseCount, demoMode, sessionId, dryRun, stepKey = 'warehouses' } = options;
    const correlationId = config?.correlationId || '∅';

    this.validateConfig(config);
    await this.validateOptions(config, options);

    let warehouseDataList;
    if (demoMode) {
      warehouseDataList = await mockData.generateWarehouseData(
        warehouseCount,
        config
      );
    } else {
      warehouseDataList = await ai.generateWarehouseData(
        warehouseCount,
        config,
        config.aiModel
      );
    }

    const useBatch = warehouseCount > 1;
    const entityType = 'warehouses';
    const operation = 'generate';
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: useBatch,
      phase: 'generate',
    });

    if (useBatch) {
      const batchERC = createERC(ERC_PREFIX.WAREHOUSE_BATCH);

      logger.info('Starting batch warehouse creation', {
        correlationId,
        operation: 'warehouses/generate:start',
        mode: 'batch',
        phase: 'generate',
        warehouseCount,
        batchSize: config.batchSize,
        sessionId,
      });

      const normalizedWarehouseDataList = warehouseDataList.map((data) =>
        this._normalizeWarehouseData(data, config)
      );

      if (dryRun) {
        logger.info('DRY RUN: Skipping warehouse batch creation.');
        logger.info({
            dryRunData: {
                step: 'warehouses',
                count: normalizedWarehouseDataList.length,
                payload: normalizedWarehouseDataList,
            },
        });
        return normalizedWarehouseDataList.map(w => ({ externalReferenceCode: w.externalReferenceCode }));
      }

      const submission = await liferay.createWarehousesBatch(
        config,
        normalizedWarehouseDataList,
        {
          externalReferenceCode: batchERC,
        }
      );

      const batchId = submission.batchId;
      const totalItems = normalizedWarehouseDataList.length;

      await persistence.createBatch({
        erc: batchERC,
        sessionId,
        stepKey,
        status: 'SUBMITTED',
        downstreamBatchId: batchId,
        totalCount: totalItems,
      });

      progress.batchStarted({
        batchId,
        batchERC,
        sessionId,
        entityType,
        operation,
        totalItems,
        correlationId
      });

      return normalizedWarehouseDataList;
    } else {
      const batchId = 'warehouses-individual';

      progress.batchStarted({
        batchId,
        entityType,
        totalItems: warehouseDataList.length,
        operation,
        sessionId,
        correlationId
      });

      const createdWarehouses = [];
      const errors = [];

      for (let index = 0; index < warehouseDataList.length; index++) {
        const warehouse = warehouseDataList[index];
        try {
          const normalizedWarehouse = this._normalizeWarehouseData(
            warehouse,
            config
          );

          if (dryRun) {
            logger.info('DRY RUN: Skipping individual warehouse creation', {
              friendlyName: normalizedWarehouse.name?.en_US || normalizedWarehouse.externalReferenceCode,
            });
            logger.info({ dryRunData: { step: 'warehouses', payload: normalizedWarehouse }});
            createdWarehouses.push(normalizedWarehouse);
            continue;
          }

          const createdWarehouse = await liferay.createWarehouse(
            config,
            normalizedWarehouse
          );
          createdWarehouses.push(createdWarehouse);
        } catch (error) {
          errors.push({ index, error: error.message });
          logger.error('Warehouse creation failed', {
            correlationId,
            operation: 'warehouses/create:error',
            error: error.message,
            index,
            externalReferenceCode: warehouse.externalReferenceCode,
          });
        }

        progress.batchProgress({
          batchId,
          entityType,
          completedCount: index + 1,
          totalItems: warehouseDataList.length,
          sessionId,
          correlationId,
        });
      }

      progress.batchCompleted({
        batchId,
        entityType,
        successCount: createdWarehouses.length,
        failureCount: errors.length,
        errors,
        operation,
        sessionId,
        correlationId,
      });
      
      logger.info('Warehouse creation completed', {
        correlationId,
        operation: 'warehouses/generate:complete',
        created: createdWarehouses.length,
        errors: errors.length,
        mode,
        phase,
      });

      return createdWarehouses;
    }
  }

  validateConfig(config) {
    const pollingRetriesValue = config.pollingRetries;
    if (pollingRetriesValue === undefined || pollingRetriesValue === null) {
      throw new Error('pollingRetries is required');
    }
    const pollingRetries = parseInt(pollingRetriesValue);
    if (isNaN(pollingRetries) || pollingRetries < 0 || pollingRetries > 20) {
      throw new Error('pollingRetries must be between 0 and 20');
    }
    const pollingDelayValue = config.pollingDelay;
    if (pollingDelayValue === undefined || pollingDelayValue === null) {
      throw new Error('pollingDelay is required');
    }
    const pollingDelay = parseInt(pollingDelayValue);
    if (isNaN(pollingDelay) || pollingDelay < 5000 || pollingDelay > 600000) {
      throw new Error('pollingDelay must be between 5 and 600 seconds');
    }
  }

  async validateOptions(config, options) {
    const { ai, logger } = this.ctx;

    if (
      !options.warehouseCount ||
      typeof options.warehouseCount !== 'number' ||
      options.warehouseCount <= 0
    ) {
      throw new Error('warehouseCount must be greater than 0');
    }

    if (!options.demoMode) {
      if (!config.aiModel) {
        const err = new Error(
          'AI model not configured. Please select an AI model in the AI Configuration object.'
        );
        err.statusCode = 400;
        logger.error(
          '✗ AI model validation failed for warehouses: missing aiModel'
        );
        throw err;
      }

      await ai.getOpenAIClient(config);
    }
  }
}

module.exports = WarehouseGenerator;