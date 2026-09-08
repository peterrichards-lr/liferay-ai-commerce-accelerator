const { WORKFLOW_STEPS } = require('./constants.cjs');

const S = WORKFLOW_STEPS;

/**
 * The media steps as a subflow of their own.
 *
 * Media is the most expensive part of a run and nothing downstream reads what
 * it produces, so it is composed separately from the product steps and placed
 * last: a run that exhausts its budget or fails partway has then already
 * produced the commerce data the media would have decorated, rather than
 * having spent that budget on decoration first.
 */
function buildMediaSubflow() {
  return {
    name: 'subflow-media',
    type: 'sequence',
    steps: [
      { name: S.ATTACH_IMAGES, type: 'sync' },
      { name: S.ATTACH_PDFS, type: 'sync' },
    ],
  };
}

module.exports = { buildMediaSubflow };
