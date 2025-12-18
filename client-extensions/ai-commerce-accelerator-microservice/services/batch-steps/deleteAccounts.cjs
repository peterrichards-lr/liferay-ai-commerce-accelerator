module.exports = async function deleteAccounts(
  { liferay },
  { config, options, callbackUrl, channelId, batchERC }
) {
  const nextCallbackUrl = `${callbackUrl}&entity=accounts`;
  const result = await liferay.deleteCommerceAccounts(
    config,
    { ...options, channelId, callbackBatchERC: batchERC },
    nextCallbackUrl
  );
  return result;
};
