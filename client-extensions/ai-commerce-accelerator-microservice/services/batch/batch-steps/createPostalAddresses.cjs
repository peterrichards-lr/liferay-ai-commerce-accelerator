const { createERC } = require('../../../utils/misc.cjs');

module.exports = async function createPostalAddresses(
  { liferay, logger },
  { config, options, callbackUrl, batchERC, lastBatchResults, accounts }
) {
  logger.info('createPostalAddresses step started. Received lastBatchResults:', {
    batchERC,
    lastBatchResults: JSON.stringify(lastBatchResults, null, 2)
  });

  const createdAccounts = lastBatchResults;
  const accountsWithAddresses = accounts;

  if (!createdAccounts || createdAccounts.length === 0 || !accountsWithAddresses) {
    logger.warn('Cannot create postal addresses, missing created accounts or original account data.', { 
        batchERC, 
        hasCreatedAccounts: !!createdAccounts,
        createdAccountsCount: createdAccounts?.length,
        hasAccountsWithAddresses: !!accountsWithAddresses
     });
    return { batchRefs: [] };
  }

  const batchPromises = [];

  for (const createdAccount of createdAccounts) {
    const accountData = accountsWithAddresses.find(
      (acc) => acc.externalReferenceCode === createdAccount.externalReferenceCode
    );

    if (accountData) {
      const addresses = [];
      if (accountData.billingAddress) {
        addresses.push({ ...accountData.billingAddress, addressType: 'billing', primary: true });
      }
      if (accountData.shippingAddress) {
        addresses.push({ ...accountData.shippingAddress, addressType: 'shipping', primary: false });
      }

      logger.info(`Found ${addresses.length} addresses for account ERC ${createdAccount.externalReferenceCode}`, { batchERC });

      if (addresses.length > 0) {
        batchPromises.push(
          liferay.createAccountAddressBatch(
            config,
            createdAccount.id,
            addresses,
            callbackUrl,
            { externalReferenceCode: createERC('ADDRESS_BATCH') }
          )
        );
      }
    } else {
        logger.warn(`No matching original account data found for created account with ERC ${createdAccount.externalReferenceCode}`, { batchERC });
    }
  }

  if (batchPromises.length === 0) {
    logger.warn('No address creation batches were initiated.', { batchERC });
    return { batchRefs: [] };
  }

  const results = await Promise.all(batchPromises);

  return {
    batchRefs: results.flatMap(result => result.batchRefs)
  };
};
