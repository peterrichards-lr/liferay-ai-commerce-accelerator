const { createERC, toI18n } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class WarehouseGenerator {
  constructor(ctx) {
    this.ctx = ctx;
  }

  _normalizeWarehouseData(warehouseData, config) {
    const name = toI18n(warehouseData.name, config.localeCode);
    const description = toI18n(warehouseData.description, config.localeCode);
    
    return {
      ...warehouseData,
      name,
      description,
      externalReferenceCode: warehouseData.externalReferenceCode || createERC(ERC_PREFIX.WAREHOUSE),
    };
  }

  async createWarehouses(config, options) {
    const { logger, ai, mockData } = this.ctx;
    const { productCount, demoMode } = options;

    logger.info('Entered createWarehouses', { options });

    let warehouses;

    if (demoMode) {
      const warehouseCount = options.warehouseCount || Math.max(1, Math.floor(productCount / 200));
      logger.info(`Generating ${warehouseCount} mock warehouses.`);
      warehouses = mockData.generateWarehouseData(warehouseCount);
    } else {
      const warehouseCount = options.warehouseCount || Math.max(1, Math.floor(productCount / 200));
      logger.info(`Generating ${warehouseCount} AI warehouses.`);
      warehouses = await ai.generateWarehouseData(warehouseCount, config, config.aiModel);
    }

    logger.info('Generated warehouse data:', warehouses);
    
    const liferay = this.ctx.liferay;

    const createdWarehouses = [];

    for(const warehouse of warehouses) {
        const normalizedWarehouse = this._normalizeWarehouseData(warehouse, config);
        logger.info('Normalized warehouse for Liferay:', normalizedWarehouse);
        const createdWarehouse = await liferay.createWarehouse(config, normalizedWarehouse);
        createdWarehouses.push(createdWarehouse);
        logger.info(`Created warehouse: ${createdWarehouse.name}`);
    }

    return createdWarehouses;
  }
}

module.exports = WarehouseGenerator;