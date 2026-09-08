const {
  createERC,
  delay,
  resolveErrorReference,
} = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');

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
async function runMediaStep(sessionId, stepKey) {
  const { entityType, contextKey, scopedProducts, attach } =
    MEDIA_STEPS.get(stepKey);
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

    return await this.completeSyncStep(sessionId, stepKey);
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
