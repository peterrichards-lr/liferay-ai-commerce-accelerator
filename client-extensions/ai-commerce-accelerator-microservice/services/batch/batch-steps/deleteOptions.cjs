module.exports = async function deleteOptions(
  { liferay },
  { config, options, batchERC }
) {
  const result = await liferay.deleteOptionsBatch(
    config,
    { ...options, callbackBatchERC: batchERC }
  );
  return result;
};
