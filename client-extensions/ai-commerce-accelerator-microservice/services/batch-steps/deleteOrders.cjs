module.exports = async function deleteOrders(
  { liferay },
  { config, options, callbackUrl, channelId, batchERC }
) {
  const nextCallbackUrl = `${callbackUrl}&entity=orders`;
  const result = await liferay.deleteCommerceOrders(
    config,
    { ...options, channelId, callbackBatchERC: batchERC },
    nextCallbackUrl
  );
  return result;
};
