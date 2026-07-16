const {
  createERC,
  buildStableERC,
  fromI18n,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');

const S = WORKFLOW_STEPS;

async function runEnsureCategoriesStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, productDataList } = session.context;

  this.logger.info('Starting ensure categories step', {
    sessionId,
    correlationId: session.correlationId,
  });

  if (!productDataList || productDataList.length === 0) {
    return await this.completeSyncStep(
      sessionId,
      S.ENSURE_CATEGORIES,
      'BYPASSED'
    );
  }

  try {
    const defaultLocale = config.localeCode || 'en-US';
    const defaultLocaleKey = defaultLocale.replace('-', '_');

    // Fallback siteGroupId resolution
    let siteGroupId = parseInt(config.siteGroupId, 10);
    if (!siteGroupId || isNaN(siteGroupId) || siteGroupId <= 0) {
      this.logger.info(
        'siteGroupId is missing or invalid in config. Resolving fallback site from DXP...',
        { sessionId }
      );
      try {
        const sitesRes = await this.liferay.rest._get(
          config,
          '/o/headless-admin-site/v1.0/sites',
          'get-sites-fallback'
        );
        const sites = sitesRes?.items || [];
        if (sites && sites.length > 0) {
          const guestSite = sites.find(
            (s) =>
              s.friendlyUrlPath === '/guest' ||
              s.name?.toLowerCase() === 'guest'
          );
          const targetSite = guestSite || sites[0];
          siteGroupId = parseInt(targetSite.id, 10);
          this.logger.info(
            `Resolved fallback siteGroupId: ${siteGroupId} (${targetSite.name})`,
            { sessionId }
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to resolve fallback siteGroupId (handled): ${err.message}`,
          { sessionId }
        );
      }
    }

    if (!siteGroupId || isNaN(siteGroupId) || siteGroupId <= 0) {
      throw new Error(
        'Unable to resolve a valid siteGroupId for taxonomy search.'
      );
    }

    // 1. Get vocabularies
    let vocabularies = await this.liferay.getTaxonomyVocabularies(
      config,
      siteGroupId
    );
    if (!Array.isArray(vocabularies)) {
      vocabularies = vocabularies?.items || [];
    }

    // 2. Select or create target vocabulary
    let targetVocab = vocabularies.find((v) => {
      const vName =
        typeof v.name === 'string' ? v.name : fromI18n(v.title || v.name);
      return vName && /category|catalog|product/i.test(vName);
    });

    if (!targetVocab && vocabularies.length > 0) {
      targetVocab = vocabularies[0];
    }

    let vocabularyId;
    if (targetVocab) {
      vocabularyId = targetVocab.id;
    } else {
      // Create a default vocabulary
      this.logger.info(
        'No taxonomy vocabulary found, creating default Category vocabulary',
        { sessionId }
      );
      const newVocab = await this.liferay.rest._post(
        config,
        `/o/headless-admin-taxonomy/v1.0/sites/${config.siteGroupId}/taxonomy-vocabularies`,
        {
          name: 'Category',
          name_i18n: {
            [defaultLocaleKey]: 'Category',
          },
          externalReferenceCode: 'VOCAB-CATEGORY',
        },
        'create-default-vocabulary',
        'Failed to create default category vocabulary'
      );
      vocabularyId = newVocab.id;
    }

    // 3. Get existing categories inside target vocabulary
    let existingCategories = await this.liferay.getTaxonomyCategories(
      config,
      vocabularyId
    );
    if (!Array.isArray(existingCategories)) {
      existingCategories = existingCategories?.items || [];
    }

    const categoryMap = new Map();
    for (const cat of existingCategories) {
      if (cat.externalReferenceCode) {
        categoryMap.set(cat.externalReferenceCode.toUpperCase(), cat.id);
      }
      const name =
        typeof cat.name === 'string'
          ? cat.name
          : fromI18n(cat.name_i18n || cat.name);
      if (name) {
        categoryMap.set(name.toLowerCase(), cat.id);
      }
    }

    // 4. Resolve/create categories
    const updatedProductDataList = [...productDataList];
    let processedCount = 0;

    for (const pd of updatedProductDataList) {
      if (!pd.category) {
        pd.categories = [];
        continue;
      }

      const categoryObj =
        typeof pd.category === 'string'
          ? { [defaultLocaleKey]: pd.category }
          : pd.category;
      const categoryName =
        fromI18n(categoryObj, defaultLocaleKey) || 'Default Category';
      const categoryERC = buildStableERC(ERC_PREFIX.CATEGORY || 'CAT', [
        categoryName,
      ]);

      let categoryId =
        categoryMap.get(categoryERC.toUpperCase()) ||
        categoryMap.get(categoryName.toLowerCase());

      if (!categoryId) {
        this.logger.info(`Creating taxonomy category: ${categoryName}`, {
          sessionId,
          erc: categoryERC,
        });

        const localizedNameI18n = {};
        for (const [lang, val] of Object.entries(categoryObj)) {
          localizedNameI18n[lang.replace('-', '_')] = val;
        }

        const payload = {
          name: categoryName,
          name_i18n: localizedNameI18n,
          externalReferenceCode: categoryERC,
        };

        try {
          const created = await this.liferay.createTaxonomyCategory(
            config,
            vocabularyId,
            payload
          );
          categoryId = created.id;
          categoryMap.set(categoryERC.toUpperCase(), categoryId);
          categoryMap.set(categoryName.toLowerCase(), categoryId);
        } catch (createError) {
          this.logger.warn(
            `Failed to create taxonomy category ${categoryName}, falling back to reuse search: ${createError.message}`,
            { sessionId }
          );
          // Double check if created concurrently
          const refreshedCats = await this.liferay.getTaxonomyCategories(
            config,
            vocabularyId
          );
          const found = (refreshedCats?.items || refreshedCats || []).find(
            (c) => {
              const name =
                typeof c.name === 'string'
                  ? c.name
                  : fromI18n(c.name_i18n || c.name);
              return name && name.toLowerCase() === categoryName.toLowerCase();
            }
          );
          if (found) {
            categoryId = found.id;
          } else {
            throw createError;
          }
        }
      }

      pd.categories = [categoryId];
      processedCount++;
    }

    // Save the updated product data with categories back to context
    await this.persistence.updateSessionContext(sessionId, {
      productDataList: updatedProductDataList,
    });

    await this.completeSyncStep(
      sessionId,
      S.ENSURE_CATEGORIES,
      'SYNCHRONOUS',
      processedCount,
      updatedProductDataList.length
    );
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed ensure categories step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.ENSURE_CATEGORIES,
      status: 'FAILED',
    });
    throw error;
  }
}

module.exports = {
  runEnsureCategoriesStep,
};
