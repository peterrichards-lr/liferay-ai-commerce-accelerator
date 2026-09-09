const {
  createERC,
  delay,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');
const {
  SELECTION_KEYS,
  selectShare,
  toPercentage,
} = require('../../utils/shareSelection.cjs');

const S = WORKFLOW_STEPS;

// A media-only run (#676) narrows each step to the products actually missing
// that kind of media, which is not the same set for images and PDFs. Absent
// those keys the step covers every product, as the generate flow expects.
const MEDIA_STEPS = new Map([
  [
    S.ATTACH_IMAGES,
    {
      entityType: 'images',
      contextKey: 'createdImages',
      selectionKey: SELECTION_KEYS.IMAGES,
      ratioOf: (options) => toPercentage(options?.imageRatio),
      scopedProducts: (context) => context.imageProductDataList,
      attach: (media, config, products, options) =>
        media.createImages(config, products, options),
    },
  ],
  [
    S.ATTACH_PDFS,
    {
      entityType: 'pdfs',
      contextKey: 'createdPdfs',
      selectionKey: SELECTION_KEYS.PDFS,
      ratioOf: (options) => toPercentage(options?.pdfRatio),
      scopedProducts: (context) => context.pdfProductDataList,
      attach: (media, config, products, options) =>
        media.createPdfs(config, products, options),
    },
  ],
]);

/**
 * Media is decoration: nothing downstream reads what it produces, and #676 adds
 * a way to regenerate it on its own. A run that created every product, SKU,
 * price and order but could not illustrate them has succeeded and lost its
 * pictures, so a media failure is recorded as a warning and the step is marked
 * BYPASSED - a terminal state the orchestrator does not treat as a failure -
 * rather than failing the whole session.
 */
/**
 * How many products this step set out to cover, and how many it did.
 *
 * The step used to call completeSyncStep with no counts at all, so the SDK's
 * default of 1 was broadcast and the bar read "1 / 50, Done, short" for a run
 * that had illustrated every product. It looked right before #776 only because
 * a completed step was clamped to its total (#790).
 *
 * The denominator is the selected share re-derived from the same deterministic
 * selector the generator uses - same list, ratio and key give the same set, by
 * design (#729) - rather than a second rule that could disagree with it. The
 * numerator counts *products* with media, not files: a product may carry three
 * images, and the bar counts products.
 */
function mediaCounts(step, products, options, created) {
  const covered = new Set(
    (created || []).map((item) => item?.productERC).filter(Boolean)
  ).size;

  const ratio = step.ratioOf(options);
  const selected =
    ratio === undefined
      ? products.length
      : selectShare(products, ratio, step.selectionKey).length;

  return { selected, covered };
}

async function runMediaStep(sessionId, stepKey) {
  const step = MEDIA_STEPS.get(stepKey);
  const { entityType, contextKey, scopedProducts, attach } = step;
  const session = await this.persistence.getSession(sessionId);
  const { config, options, productDataList } = session.context;
  const products = scopedProducts(session.context) || productDataList || [];

  try {
    const created = await attach(this.ctx.media, config, products, {
      ...options,
      sessionId,
    });

    await this.persistence.updateSessionContext(sessionId, {
      [contextKey]: created || [],
    });

    const { selected, covered } = mediaCounts(step, products, options, created);

    if (covered < selected) {
      this.logger.warn(
        `Attached ${entityType} to ${covered} of ${selected} selected products`,
        { sessionId, covered, selected }
      );
    }

    return await this.completeSyncStep(
      sessionId,
      stepKey,
      'SYNCHRONOUS',
      covered,
      selected
    );
  } catch (error) {
    const errorReference =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

    this.logger.warn(
      `Media step '${stepKey}' failed; continuing without ${entityType}`,
      {
        sessionId,
        errorReference,
        error: error.message,
      }
    );

    this.progress.stepWarning({
      sessionId,
      step: stepKey,
      entityType,
      operation: session.flow_type || session.flowType,
      message: `Could not attach ${entityType}: ${error.message}. The generated commerce data is unaffected.`,
      errorReference,
      correlationId: session.correlationId,
    });

    // Written directly rather than through completeSyncStep, which broadcasts a
    // step-completed event the UI reads as "100% of this entity produced".
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey,
      status: 'BYPASSED',
      processed_count: 0,
      total_count: 1,
      errorMessage: error.message,
    });

    await delay(100);

    return true;
  }
}

async function runAttachImagesStep(sessionId) {
  return runMediaStep.call(this, sessionId, S.ATTACH_IMAGES);
}

async function runAttachPdfsStep(sessionId) {
  return runMediaStep.call(this, sessionId, S.ATTACH_PDFS);
}

module.exports = {
  runAttachImagesStep,
  runAttachPdfsStep,
};
