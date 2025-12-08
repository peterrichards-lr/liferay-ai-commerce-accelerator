const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class WarehouseGenerator {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async createWarehouses(config, options) {
    const { logger } = this.ctx;
    const { productCount } = options;

    logger.warn('********************************************************************************');
    logger.warn('Warehouse creation is using a mock implementation.');
    logger.warn('The Liferay API for creating warehouses could not be found in the provided OpenAPI schemas.');
    logger.warn('This generator will create in-memory warehouse objects instead of calling a real API.');
    logger.warn('********************************************************************************');

    const warehouseCount = options.warehouseCount || Math.max(1, Math.floor(productCount / 200));
    const warehouses = [];

    for (let i = 0; i < warehouseCount; i++) {
      const warehouse = {
        id: Math.floor(Math.random() * 10000),
        name: `Warehouse ${i + 1}`,
        externalReferenceCode: createERC(ERC_PREFIX.WAREHOUSE),
        country: 'USA',
        region: 'CA',
      };
      warehouses.push(warehouse);
      logger.info(`Created mock warehouse: ${warehouse.name}`);
    }

    return warehouses;
  }
}

module.exports = WarehouseGenerator;
