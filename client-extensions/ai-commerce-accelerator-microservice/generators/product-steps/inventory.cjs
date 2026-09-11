const {
  delay,
  createERC,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const {
  SELECTION_KEYS,
  selectShare,
} = require('../../utils/shareSelection.cjs');
const {
  runRequestsInventory,
} = require('../../utils/inventoryFeasibility.cjs');
const { inventoryBoundsFor } = require('../../utils/backorderShare.cjs');
const {
  summariseFailures,
  writeEachEntity,
} = require('../../utils/entityWrites.cjs');

const S = WORKFLOW_STEPS;

const INDEXING_LAG = 'The service parameter was not provided by this object';
const ALREADY_EXISTS = 'Duplicated warehouse item';
const INDEXING_LAG_ATTEMPTS = 5;

function saidThat(error, phrase) {
  return (
    error.message?.includes(phrase) ||
    JSON.stringify(error.response?.data || {}).includes(phrase)
  );
}

/**
 * One warehouse item, with the two Liferay answers that are not failures
 * absorbed.
 *
 * The SKU this item names was created moments ago and the inventory endpoint
 * resolves it through the search index, so a rejection here is as likely to be
 * indexing lag as a real problem and is worth waiting out. A duplicate means
 * the item this run wanted is already there, which is the outcome it asked
 * for. Anything else is this item's failure and belongs to the caller.
 */
async function _createWarehouseItem({ config, item, sessionId, warehouseId }) {
  for (let attempt = 1; attempt <= INDEXING_LAG_ATTEMPTS; attempt++) {
    try {
      return await this.liferay.rest._post(
        config,
        `/o/headless-commerce-admin-inventory/v1.0/warehouses/${warehouseId}/warehouseItems`,
        item,
        'create-warehouse-item',
        'Failed to create warehouse item'
      );
    } catch (error) {
      if (saidThat(error, ALREADY_EXISTS)) {
        this.logger.info(
          `Warehouse item for SKU ${item.sku} already exists in warehouse ${warehouseId}. Bypassing creation.`,
          { sessionId }
        );
        return null;
      }

      if (!saidThat(error, INDEXING_LAG) || attempt === INDEXING_LAG_ATTEMPTS) {
        throw error;
      }

      this.logger.warn(
        `Indexing lag detected for warehouse item SKU ${item.sku}. Retrying in 2000ms... (Attempt ${attempt}/${INDEXING_LAG_ATTEMPTS})`,
        { sessionId }
      );
      await delay(2000);
    }
  }
}

async function runUpdateInventoryStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, options, productDataList } = session.context;

  // The warehouses this run is entitled to stock, which is not the same as
  // every warehouse in the instance.
  //
  // `warehouseDataList` is the run's own set: the ones it created, plus the
  // ones it adopted when reusing. Turning reuse off means the existing
  // warehouses were deliberately not adopted, so stock must not be scattered
  // into them - a run asked for a fresh set of five wants its inventory in
  // those five, not spread over the seven that now exist (#730).
  //
  // An empty set falls back to the instance, which is the case where the run
  // created no warehouses at all: "use only the ones already there". That is
  // the behaviour #664 and #692 added deliberately, so an order-only run
  // against a second channel still finds availability behind its products.
  const runWarehouses = (session.context.warehouseDataList || []).filter(
    (warehouse) => warehouse?.id
  );

  const warehouses = runWarehouses.length
    ? runWarehouses
    : (await this.liferay.getWarehouses(config))?.items;

  if (!warehouses || warehouses.length === 0) {
    // BYPASSED means a live query confirmed there was nothing to do (#699).
    // Here a live query confirmed there is nothing to do it *with*, while the
    // work was asked for - so it is BLOCKED, which does not count towards a
    // successful run and carries the reason (#732). The run should have been
    // refused up front; reaching this point means the instance changed under
    // it, or the request did not come through the generate route.
    // The route asks this of `options.productCount`, because the products do
    // not exist yet. Here they do, so the real list is the honest input - a
    // run reaching this step with products in hand asked for stock whatever
    // the original count said.
    const requested = runRequestsInventory({
      ...options,
      productCount: (productDataList || []).length,
    });

    return await this.completeSyncStep(
      sessionId,
      S.UPDATE_INVENTORY,
      requested ? 'BLOCKED' : 'BYPASSED',
      0,
      0,
      requested
        ? 'No warehouse exists to hold inventory, and this run did not create one.'
        : 'No stock was requested for this run.'
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
    const { inventoryAssignmentRatio = 100 } = options;

    // A dice roll per product made even the count vary: at 50% over 50
    // products, anywhere from roughly 18 to 32, and a different set every run.
    // The share is now an exact count, drawn independently of the image and
    // PDF shares so the same products do not carry everything (#729).
    const stockedProducts = selectShare(
      productDataList,
      inventoryAssignmentRatio,
      SELECTION_KEYS.INVENTORY,
      { logger: this.logger }
    );

    this.logger.info(
      `Assigning inventory to ${stockedProducts.length} of ${productDataList.length} products (${inventoryAssignmentRatio}%)`,
      { sessionId }
    );

    // A backorder-enabled product holding a thousand units never demonstrates
    // a backorder, so the products carrying allowBackOrder are capped - and
    // the first of them is put at zero, so the state is always there to see
    // rather than dependent on a random draw (#695). The flag is read off the
    // product data rather than recomputed, so it is the same decision the
    // product step sent to Liferay.
    let seenBackorder = false;

    for (const pd of stockedProducts) {
      const isFirstBackorder = Boolean(pd.allowBackOrder) && !seenBackorder;

      if (pd.allowBackOrder) {
        seenBackorder = true;
      }

      const bounds = inventoryBoundsFor(pd, options, { isFirstBackorder });
      const allSkus = [...(pd.skus || []), ...(pd.skuVariants || [])];

      for (const sku of allSkus) {
        if (!sku.sku) continue;

        // Assign to a random warehouse
        const warehouse =
          warehouses[Math.floor(Math.random() * warehouses.length)];

        inventoryItems.push({
          sku: sku.sku,
          quantity:
            Math.floor(Math.random() * (bounds.max - bounds.min + 1)) +
            bounds.min,
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

      const rejected = [];

      for (const wId of warehouseIds) {
        const items = byWarehouse[wId];

        let outcome = { failures: [], written: 0 };

        const { batchERC } = await this.submitBatch(
          sessionId,
          S.UPDATE_INVENTORY,
          'inventory',
          'generate',
          async (_erc) => {
            this.logger.info(
              `Simulating batch creation of ${items.length} inventory items for warehouse ${wId} directly from ProductGenerator to bypass DXP platform bugs...`,
              { sessionId }
            );

            outcome = await writeEachEntity({
              describe: (item) => item.sku,
              entities: items,
              write: (item) =>
                _createWarehouseItem.call(this, {
                  config,
                  item,
                  sessionId,
                  warehouseId: wId,
                }),
            });

            outcome.failures.forEach(({ reason, subject }) => {
              this.logger.warn(
                `Failed to create the warehouse item for SKU ${subject} in warehouse ${wId}: ${reason}`,
                { sessionId }
              );
            });

            return {
              batchId: `simulated-inventory-batch-${Date.now()}`,
              count: outcome.written,
              status: 'completed',
            };
          },
          items.length
        );

        rejected.push(...outcome.failures);

        await this.persistence.updateBatch(batchERC, {
          errorCount: outcome.failures.length,
          processedCount: outcome.written,
        });
      }

      if (rejected.length > 0) {
        const named = summariseFailures(rejected);

        this.logger.warn(
          `${rejected.length} of ${inventoryItems.length} inventory items were rejected: ${named}. The run continues - the SKUs are created and their media is unaffected (#892).`,
          { sessionId }
        );

        this.progress.stepWarning({
          correlationId: session.correlationId,
          entityType: 'inventory',
          errorReference: createERC(ERC_PREFIX.ERROR),
          message: `${rejected.length} of ${inventoryItems.length} inventory items could not be created: ${named}. Every product, price and attachment in this run is unaffected.`,
          operation: session.flow_type || session.flowType,
          sessionId,
          step: S.UPDATE_INVENTORY,
        });
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
