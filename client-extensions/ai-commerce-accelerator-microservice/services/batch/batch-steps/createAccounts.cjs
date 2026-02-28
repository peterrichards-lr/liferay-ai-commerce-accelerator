const { createERC } = require('../../../utils/misc.cjs');
const { ERC_PREFIX } = require('../../../utils/constants.cjs');

module.exports = async function createAccounts(
  { liferay },
  { config, options, callbackUrl, batchERC, accounts, sessionId }
) {
  const accountsForBatch = accounts.map((account) => {
    const { billingAddress, shippingAddress, headOfficeAddress, ...rest } =
      account;
    return rest;
  });

  const accountBatches = [];
  for (let i = 0; i < accountsForBatch.length; i += config.batchSize) {
    accountBatches.push(accountsForBatch.slice(i, i + config.batchSize));
  }

  let result = { batchRefs: [] };

  for (const batch of accountBatches) {
    const batchResult = await liferay.createAccountsBatch(
      config,
      batch,
      callbackUrl,
      {
        externalReferenceCode: batchERC,
        sessionId,
      }
    );
    result.batchRefs.push(...batchResult.batchRefs);
  }

  return result;
};
