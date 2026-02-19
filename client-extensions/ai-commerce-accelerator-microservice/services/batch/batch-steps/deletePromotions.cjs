module.exports = async function deletePromotions(
  { liferay },
  { config, options, items, batchERC, sessionId }
) {
  const result = await liferay.deletePromotionsBatch(
    config,
    { ...options, items, callbackBatchERC: batchERC, sessionId }
  );
  return result;
};
