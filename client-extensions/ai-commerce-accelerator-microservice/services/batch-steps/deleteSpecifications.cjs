module.exports = async function deleteSpecifications(
  { liferay },
  { config, options, callbackUrl, batchERC }
) {
  const nextCallbackUrl = `${callbackUrl}&entity=specifications`;
  const result = await liferay.deleteSpecificationsBatch(
    config,
    { ...options, callbackBatchERC: batchERC },
    nextCallbackUrl
  );
  return result;
};
