/**
 * Which commerce channels a run makes its products and warehouses available in.
 *
 * Products belong to a catalog, not to a channel, so one product set can back
 * several channels - the natural shape for a demo where a B2B and a B2C
 * audience browse the same catalogue. A run used to associate everything it
 * created with `config.channelId` alone, so a later run against a second
 * channel had nothing to reuse. See #664.
 */
const { WORKFLOW_STEPS } = require('./constants.cjs');

function toChannelId(value) {
  const id = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isInteger(id) ? id : undefined;
}

/**
 * `config.channelId` stays first and the list is de-duplicated, so a run that
 * names one channel produces exactly the payload it produced before
 * `channelIds` existed.
 */
function resolveRunChannelIds(config = {}) {
  const requested = [
    config.channelId,
    ...(Array.isArray(config.channelIds) ? config.channelIds : []),
  ];

  return [
    ...new Set(requested.map(toChannelId).filter((id) => id !== undefined)),
  ];
}

/**
 * The steps that attach this run's channels to a catalogue an earlier run
 * built.
 *
 * A run that places orders without generating any products of its own is
 * reusing products that already exist, and the run that created them
 * associated them - and the warehouses holding their stock - only with its own
 * channel. Backfilling both is what lets the second half of a
 * "B2C first, then B2B" build order the same products.
 */
function channelBackfillSteps(options = {}) {
  if (!(options.orderCount > 0) || options.productCount > 0) {
    return [];
  }

  return [
    { name: WORKFLOW_STEPS.LINK_PRODUCT_CHANNELS, type: 'sync' },
    { name: WORKFLOW_STEPS.LINK_WAREHOUSE_CHANNELS, type: 'sync' },
  ];
}

module.exports = {
  channelBackfillSteps,
  resolveRunChannelIds,
};
