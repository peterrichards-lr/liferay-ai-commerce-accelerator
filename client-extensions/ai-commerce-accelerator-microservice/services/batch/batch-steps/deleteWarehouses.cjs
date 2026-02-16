module.exports = async function deleteWarehouses(
  { liferay, persistence, batchCallback, logger },
  { config, options, callbackUrl, batchERC, sessionId }
) {
  const warehouses = await liferay.getWarehousesPage(config, {
    pageSize: 200,
  });
  const warehouseIds = liferay._asItems(warehouses).map((w) => w.id);

  logger.info(`Found ${warehouseIds.length} warehouses to delete.`, {
    warehouseIds,
  });

  for (const warehouseId of warehouseIds) {
    try {
      logger.info(`Attempting to delete warehouse ${warehouseId}`);
      await liferay.deleteWarehouse(config, warehouseId);
      logger.debug(`Deleted warehouse ${warehouseId}`);
    } catch (error) {
      logger.error(`Failed to delete warehouse ${warehouseId}`, {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  await persistence.updateBatch(batchERC, { status: 'COMPLETED' });

  // Manually trigger the session completion check to advance the workflow
  await batchCallback._checkSessionCompletion(sessionId, config.correlationId);

  return { success: true, count: warehouseIds.length };
};
