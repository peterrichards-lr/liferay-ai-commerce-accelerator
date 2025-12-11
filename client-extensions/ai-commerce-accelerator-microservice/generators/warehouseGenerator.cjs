const { createERC, toI18n, resolvePhaseAndMode } = require('../utils/misc.cjs');
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
      externalReferenceCode: rest.externalReferenceCode || createERC(ERC_PREFIX.WAREHOUSE),
    };
  }

  async createWarehouses(config, options) {
    const { logger, ai, mockData, getWs, liferay } = this.ctx;
    const { productCount, demoMode } = options;
    const correlationId = config?.correlationId || '∅';
    const warehouseCount =
      options.warehouseCount || Math.max(1, Math.floor((productCount || 0) / 200)) || 1;

    let warehouseDataList;
    if (demoMode) {
      warehouseDataList = mockData.generateWarehouseData(warehouseCount);
    } else {
      warehouseDataList = await ai.generateWarehouseData(
        warehouseCount,
        config,
        config.aiModel
      );
    }

    const entityType = 'warehouses';
    const operation = 'generate';
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: false,
      phase: 'generate',
    });
    const batchId = 'warehouses-individual';

    const ws = typeof getWs === 'function' ? getWs() : getWs;

    if (ws && typeof ws.emitBatchStarted === 'function') {
      ws.emitBatchStarted(
        {
          batchId,
          entityType,
          totalItems: warehouseDataList.length,
          operation,
          mode,
          phase,
        },
        { correlationId }
      );
    }

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

      const processed = index + 1;
      if (ws && typeof ws.emitBatchProgress === 'function') {
        const totalItems = warehouseDataList.length;
        const progress =
          totalItems > 0 ? Math.round((processed / totalItems) * 100) : 0;

        ws.emitBatchProgress(
          {
            batchId,
            entityType,
            completedCount: processed,
            totalItems,
            progress,
            operation,
            mode,
            phase,
          },
          { correlationId }
        );
      }
    }

    if (ws && typeof ws.emitBatchCompleted === 'function') {
      ws.emitBatchCompleted(
        {
          batchId,
          entityType,
          successCount: createdWarehouses.length,
          failureCount: errors.length,
          errors,
          operation,
          mode,
          phase,
        },
        { correlationId }
      );
    }

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

module.exports = WarehouseGenerator;