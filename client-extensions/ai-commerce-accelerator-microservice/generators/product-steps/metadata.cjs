const { fromI18n } = require('../../utils/misc.cjs');
const { WORKFLOW_STEPS } = require('../../utils/constants.cjs');

const S = WORKFLOW_STEPS;

async function runLoadMetadataStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config } = session.context;

  this.logger.info('Loading Liferay metadata for AI grounding', {
    sessionId,
  });

  try {
    // 1. Fetch available languages for the site
    // 2. Fetch available currencies for the catalog
    // 3. Fetch taxonomy vocabularies and categories for the site
    const [languages, currencies, vocabularies] = await Promise.all([
      this.liferay.getLanguages(config, config.siteGroupId),
      this.liferay.getCurrencies(config),
      this.liferay.getTaxonomyVocabularies(config, config.siteGroupId),
    ]);

    // Flatten vocabularies and categories for easier AI consumption
    const vocabWithCategories = await Promise.all(
      (vocabularies || []).map(async (v) => {
        try {
          const categories = await this.liferay.getTaxonomyCategories(
            config,
            v.id
          );
          return {
            name: v.name,
            categories: (categories || []).map((c) => ({
              id: c.id,
              name: c.name,
              erc: c.externalReferenceCode,
            })),
          };
        } catch (_e) {
          return { name: v.name, categories: [] };
        }
      })
    );

    await this.persistence.updateSessionContext(sessionId, {
      groundingMetadata: {
        languages: (languages?.items || languages || []).map((l) => ({
          id: l.id,
          name: l.name,
          default: l.markedAsDefault,
        })),
        currencies: (currencies || []).map((c) => ({
          code: c.code,
          name: fromI18n(c.name),
          active: c.active,
        })),
        vocabularies: vocabWithCategories,
      },
    });

    await this.completeSyncStep(sessionId, S.LOAD_METADATA);
  } catch (error) {
    this.logger.error('Failed to load Liferay metadata for grounding', {
      sessionId,
      error: error.message,
    });
    // Non-fatal, continue without grounding
    await this.completeSyncStep(sessionId, S.LOAD_METADATA, 'WARNING');
  }
}

module.exports = {
  runLoadMetadataStep,
};
