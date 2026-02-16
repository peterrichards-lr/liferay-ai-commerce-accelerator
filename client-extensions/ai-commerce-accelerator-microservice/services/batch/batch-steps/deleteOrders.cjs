module.exports = async function deleteOrders(
  { liferay },
  { config, options, channelId, batchERC }
) {
  const result = await liferay.deleteCommerceOrders(
    config,
    { ...options, channelId, callbackBatchERC: batchERC }
  );
  return result;
};

