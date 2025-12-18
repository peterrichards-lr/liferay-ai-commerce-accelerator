module.exports = async function deleteOptions(
  { liferay },
  { config, options, callbackUrl, batchERC }
) {
  const nextCallbackUrl = `${callbackUrl}&entity=options`;
  const result = await liferay.deleteOptionsBatch(
    config,
    { ...options, callbackBatchERC: batchERC },
    nextCallbackUrl
  );
  return result;
};
