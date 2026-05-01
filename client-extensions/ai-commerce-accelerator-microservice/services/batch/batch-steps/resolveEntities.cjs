module.exports = async function resolveEntities(
  { liferay, logger },
  { config, accounts, entityTypeToResolve }
) {
  const sourceAccounts = accounts;

  if (!sourceAccounts || sourceAccounts.length === 0) {
    logger.warn('resolveEntities called with no source accounts to process.', {
      entityTypeToResolve,
    });
    return { enrichedResults: [] };
  }

  const getByERCMethod = {
    accounts: liferay.getAccountByERC.bind(liferay),
    // Add other entity types here as needed in the future
  }[entityTypeToResolve];

  if (!getByERCMethod) {
    logger.warn(
      `No ERC lookup method configured for entity type: '${entityTypeToResolve}'. Passing results through.`,
      { entityTypeToResolve }
    );
    return { enrichedResults: sourceAccounts };
  }

  const enrichedResults = [];
  logger.info(
    `Resolving IDs for ${sourceAccounts.length} entities of type '${entityTypeToResolve}'`
  );

  for (const account of sourceAccounts) {
    if (account.externalReferenceCode) {
      try {
        const fullEntity = await getByERCMethod(
          config,
          account.externalReferenceCode
        );
        if (fullEntity) {
          enrichedResults.push(fullEntity);
        } else {
          logger.warn('Failed to resolve entity for ERC', {
            entityTypeToResolve,
            externalReferenceCode: account.externalReferenceCode,
          });
        }
      } catch (e) {
        logger.error('Error while resolving entity for ERC', {
          entityTypeToResolve,
          externalReferenceCode: account.externalReferenceCode,
          error: e.message,
        });
      }
    }
  }

  logger.info(
    `Successfully resolved ${enrichedResults.length} out of ${sourceAccounts.length} entities.`
  );

  return enrichedResults;
};
