module.exports = async function deleteSpecifications(
  { liferay },
  { config, options, batchERC }
) {
  const result = await liferay.deleteSpecificationsBatch(
    config,
    { ...options, callbackBatchERC: batchERC }
  );
  return result;
};
