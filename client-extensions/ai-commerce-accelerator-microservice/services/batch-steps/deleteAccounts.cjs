module.exports = async function deleteAccounts(
  { liferay },
  { config, options, channelId, batchERC }
) {
  const result = await liferay.deleteCommerceAccounts(
    config,
    { ...options, channelId, callbackBatchERC: batchERC }
  );
  return result;
};
