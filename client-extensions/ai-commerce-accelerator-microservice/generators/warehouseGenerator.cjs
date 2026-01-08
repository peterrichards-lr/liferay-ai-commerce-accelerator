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
    const { logger, ai, mockData, progress, liferay } =
      this.ctx;
    const { warehouseCount, demoMode, sessionId } = options;
    const correlationId = config?.correlationId || '∅';

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

      const submission = await liferay.createWarehousesBatch(
        config,
        normalizedWarehouseDataList,
        {
          externalReferenceCode: batchERC,
        }
      );

      const batchId = submission.batchId;
      const totalItems = normalizedWarehouseDataList.length;

      progress.batchStarted({
        batchId,
        batchERC,
        sessionId,
        entityType,
        operation,
        totalItems,
        correlationId
      });

      return submission.batchRefs;
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
}

module.exports = WarehouseGenerator;