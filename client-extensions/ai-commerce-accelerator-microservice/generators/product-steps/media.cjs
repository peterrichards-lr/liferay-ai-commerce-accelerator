const { createERC, resolveErrorReference } = require('../../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../../utils/constants.cjs');

const S = WORKFLOW_STEPS;

async function runAttachImagesStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, options, productDataList } = session.context;
  try {
    const createdImages = await this.ctx.media.createImages(
      config,
      productDataList || [],
      {
        ...options,
        sessionId,
      }
    );
    await this.persistence.updateSessionContext(sessionId, {
      createdImages: createdImages || [],
    });
    await this.completeSyncStep(sessionId, S.ATTACH_IMAGES);
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed attach images step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.ATTACH_IMAGES,
      status: 'FAILED',
    });
    throw error;
  }
}

async function runAttachPdfsStep(sessionId) {
  const session = await this.persistence.getSession(sessionId);
  const { config, options, productDataList } = session.context;
  try {
    const createdPdfs = await this.ctx.media.createPdfs(
      config,
      productDataList || [],
      {
        ...options,
        sessionId,
      }
    );
    await this.persistence.updateSessionContext(sessionId, {
      createdPdfs: createdPdfs || [],
    });
    await this.completeSyncStep(sessionId, S.ATTACH_PDFS);
  } catch (error) {
    const errorReferenceCode =
      resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
    this.logger.error('Failed attach PDFs step', {
      sessionId,
      errorReferenceCode,
      error: error.message,
    });
    await this.persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: S.ATTACH_PDFS,
      status: 'FAILED',
    });
    throw error;
  }
}

module.exports = {
  runAttachImagesStep,
  runAttachPdfsStep,
};
