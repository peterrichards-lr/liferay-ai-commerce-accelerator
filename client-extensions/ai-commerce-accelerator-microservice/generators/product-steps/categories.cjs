const {
  createERC,
  fromI18n,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const {
  normaliseCategoryTree,
  buildCategoryPathIndex,
  categoryPathFor,
} = require('../../utils/categoryTree.cjs');
const { ensureCategoryPath } = require('../../utils/ensureCategoryPath.cjs');

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

    // 3b. The configured hierarchy, read once.
    //
    // Products carry a category NAME; the tree turns that back into the
    // ancestry Liferay needs. Failure here is non-fatal and leaves an empty
    // index, under which every category resolves to a path of one - exactly
    // the flat behaviour that shipped before #1204. A taxonomy refinement
    // must not cost the product run.
    let categoryPathIndex = new Map();

    try {
      const configured = await this.ctx?.config?.getCategories?.(config);
      const { index, ambiguous } = buildCategoryPathIndex(
        normaliseCategoryTree(configured)
      );

      categoryPathIndex = index;

      if (ambiguous.length > 0) {
        // Said out loud rather than resolved silently: the product carries a
        // name, not a path, so nothing here can know which branch was meant.
        this.logger.warn(
          `${ambiguous.length} category name(s) appear under more than one parent; the first path wins`,
          {
            sessionId,
            names: ambiguous.map((a) => ({
              name: a.name,
              used: a.kept.join(' > '),
              ignored: a.ignored.join(' > '),
            })),
          }
        );
      }
    } catch (treeError) {
      this.logger.warn(
        `Could not read the configured categories; falling back to flat categories: ${treeError.message}`,
        { sessionId }
      );
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
      // The ERC is keyed by the full PATH, not the leaf name.
      //
      // Hashing the name alone was sound while categories were a flat set of
      // unique strings. Under #1204 it is not: "Outdoor > Chairs" and
      // "Indoor > Chairs" collide on one ERC and the reuse map hands the first
      // category's id to both. A top-level path is [name], so its ERC is
      // unchanged and existing data does not churn.
      //
      // utils/ensureCategoryPath.cjs also creates parent-first: Liferay posts
      // a child to /taxonomy-categories/{parentId}/..., so the parent's id has
      // to exist before the child can be created at all.
      const categoryPath = categoryPathFor(categoryPathIndex, categoryName);

      const { ids: categoryIds, failedAt } = await ensureCategoryPath({
        path: categoryPath,
        cache: categoryMap,
        vocabularyId,
        createCategory: (vocabId, payload, parentId) =>
          this.liferay.createTaxonomyCategory(
            config,
            vocabId,
            payload,
            parentId
          ),
        localise: (name) => {
          // Only the leaf carries the product's localised names. An ancestor
          // supplied by the tree has no translations to offer and must not
          // borrow the leaf's.
          if (name !== categoryName) return null;

          const i18n = {};

          for (const [lang, val] of Object.entries(categoryObj)) {
            i18n[lang.replace('-', '_')] = val;
          }

          return i18n;
        },
      });

      if (failedAt) {
        this.logger.warn(
          `Could not create category '${failedAt.join(' > ')}'; the product keeps the ancestors that resolved`,
          { sessionId, productERC: pd.externalReferenceCode }
        );
      }

      // Assigned only when something resolved. An undefined id put
      // `[undefined]` on the product, which became `[{}]` in the payload and
      // cost the whole item. See #651.
      if (categoryIds.length === 0) {
        this.logger.warn(
          `Could not resolve a Liferay category for '${categoryName}'; the product will be created without one`,
          { sessionId, productERC: pd.externalReferenceCode }
        );
        pd.categories = [];
      } else {
        // Leaf AND ancestors. Liferay does not imply them, so a product under
        // "Outdoor > Tents" carrying only the Tents id does not appear when
        // browsing Outdoor - which is what faceted navigation does.
        pd.categories = categoryIds;
      }

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
