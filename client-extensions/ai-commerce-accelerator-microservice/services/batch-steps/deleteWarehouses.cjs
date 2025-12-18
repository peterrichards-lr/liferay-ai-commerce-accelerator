module.exports = async function deleteWarehouses(
  { deleteCoordinatorService, ws },
  { config, ids }
) {
  const result = await deleteCoordinatorService._deleteWarehouses(
    config,
    ids,
    config.correlationId,
    ws
  );
  return result;
};
