const { utils } = require('@liferay/accelerator-sdk');
const { ENV } = require('./constants.cjs');

/**
 * The search-reindex OSGi module's application base, resolved the same way
 * LiferayRestService.triggerReindex resolves it: an explicit override first,
 * the SDK's own DEFAULT_REINDEX_BASE_PATH otherwise. Computed once here,
 * rather than duplicating either half of that resolution in AICA, so
 * utils/normalize.cjs (and routes/mcp.cjs's own config builder) can put it on
 * every config as config.reindexBasePath - the highest-priority input
 * triggerReindex reads - and utils/reindexStatus.cjs can name the path a
 * failure actually used instead of guessing at one. See #674, #675.
 */
const REINDEX_BASE_PATH = utils.normalizeApplicationBasePath(
  ENV.LIFERAY_REINDEX_BASE_PATH,
  utils.constants.DEFAULT_REINDEX_BASE_PATH
);

module.exports = {
  asItems: utils.asItems,
  REINDEX_BASE_PATH,
};
