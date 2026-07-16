const {
  delay,
  createERC,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');

const S = WORKFLOW_STEPS;

async function runUpdateInventoryStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, options, productDataList } = session.context;

  // Hard-resolving warehouses to ensure we have IDs and ERCs
  const { items: warehouses } = await this.liferay.getWarehouses(config);

  if (!warehouses || warehouses.length === 0) {
    return await this.completeSyncStep(
      sessionId,
      S.UPDATE_INVENTORY,
      'BYPASSED'
    );
  }

  try {
    this.logger.info(
      `Starting inventory update for ${productDataList.length} products across ${warehouses.length} warehouses...`,
      { sessionId }
    );

    // HARDENING: Brief delay to allow SKUs to be indexed by Liferay
    // Inventory requires the SKU string to be 'resolvable' by the backend.
    await delay(3000);

    const inventoryItems = [];
    const {
      inventoryMin = 10,
      inventoryMax = 100,
      inventoryAssignmentRatio = 100,
    } = options;

    for (const pd of productDataList) {
      // Roll dice for assignment ratio
      if (Math.random() * 100 > inventoryAssignmentRatio) continue;

      const allSkus = [...(pd.skus || []), ...(pd.skuVariants || [])];
      for (const sku of allSkus) {
        if (!sku.sku) continue;

        // Assign to a random warehouse
        const warehouse =
          warehouses[Math.floor(Math.random() * warehouses.length)];

        inventoryItems.push({
          sku: sku.sku,
          quantity:
            Math.floor(Math.random() * (inventoryMax - inventoryMin + 1)) +
            inventoryMin,
          warehouseId: warehouse.id,
        });
      }
    }

    if (inventoryItems.length > 0) {
      // HARDENING: Group by warehouse to ensure compatibility with scoped Batch API
      const byWarehouse = inventoryItems.reduce((acc, item) => {
        if (!acc[item.warehouseId]) acc[item.warehouseId] = [];
        acc[item.warehouseId].push(item);
        return acc;
      }, {});

      const warehouseIds = Object.keys(byWarehouse);
      this.logger.info(
        `Submitting ${inventoryItems.length} inventory items across ${warehouseIds.length} warehouse-specific batches.`
      );

      for (const wId of warehouseIds) {
        const items = byWarehouse[wId];

        await this.submitBatch(
          sessionId,
          S.UPDATE_INVENTORY,
          'inventory',
          'generate',
          (_erc) => {
            this.logger.info(
              `Simulating batch creation of ${items.length} inventory items for warehouse ${wId} directly from ProductGenerator to bypass DXP platform bugs...`,
              { sessionId }
            );

            const runSimulation = async () => {
              const results = {
                status: 'completed',
                batchId: `simulated-inventory-batch-${Date.now()}`,
                count: 0,
                errors: [],
              };

              const concurrency = 5;
              for (let i = 0; i < items.length; i += concurrency) {
                const chunk = items.slice(i, i + concurrency);
                await Promise.all(
                  chunk.map(async (item) => {
                    let retryCount = 0;
                    let success = false;
                    let lastErr = null;

                    while (retryCount < 5 && !success) {
                      try {
                        await this.liferay.rest._post(
                          config,
                          `/o/headless-commerce-admin-inventory/v1.0/warehouses/${wId}/warehouseItems`,
                          item,
                          'create-warehouse-item',
                          'Failed to create warehouse item'
                        );
                        success = true;
                        results.count++;
                      } catch (err) {
                        lastErr = err;
                        const isServiceParamError =
                          err.message?.includes(
                            'The service parameter was not provided by this object'
                          ) ||
                          JSON.stringify(err.response?.data || {}).includes(
                            'The service parameter was not provided by this object'
                          );

                        const isDuplicate =
                          err.message?.includes('Duplicated warehouse item') ||
                          err.response?.data?.errorDescription ===
                            'Duplicated warehouse item' ||
                          JSON.stringify(err.response?.data || {}).includes(
                            'Duplicated warehouse item'
                          );

                        if (isServiceParamError) {
                          retryCount++;
                          if (retryCount < 5) {
                            this.logger.warn(
                              `Indexing lag detected for warehouse item SKU ${item.sku}. Retrying in 2000ms... (Attempt ${retryCount}/5)`,
                              { sessionId }
                            );
                            await delay(2000);
                          } else {
                            break; // exhausted retries
                          }
                        } else if (isDuplicate) {
                          this.logger.info(
                            `Warehouse item for SKU ${item.sku} already exists in warehouse ${wId}. Bypassing creation.`,
                            { sessionId }
                          );
                          success = true;
                          results.count++;
                          break; // success via duplicate handling
                        } else {
                          break; // other unknown error, break to throw/log
                        }
                      }
                    }

                    if (!success && lastErr) {
                      results.errors.push({
                        sku: item.sku,
                        error: lastErr.message,
                      });
                      this.logger.warn(
                        `Failed to create simulated batch warehouse item for SKU ${item.sku}: ${lastErr.message}`,
                        { sessionId }
                      );
                    }
                  })
                );
              }

              if (results.errors.length > 0) {
                throw new Error(
                  `Failed to create ${results.errors.length} warehouse items during simulated batch`
                );
              }
              return results;
            };

            return runSimulation();
          },
          items.length
        );
      }
    } else {
      await this.completeSyncStep(sessionId, S.UPDATE_INVENTORY, 'BYPASSED');
    }
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed update inventory step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.UPDATE_INVENTORY,
      status: 'FAILED',
    });
    throw error;
  }
}

module.exports = {
  runUpdateInventoryStep,
};
