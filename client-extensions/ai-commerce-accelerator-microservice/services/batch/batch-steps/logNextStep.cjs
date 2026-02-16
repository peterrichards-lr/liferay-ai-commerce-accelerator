module.exports = async function logNextStep(
  { logger },
  { batchERC, lastBatchResults }
) {
  logger.info('SUCCESS: The logNextStep was called.', {
    batchERC,
    lastBatchResultCount: lastBatchResults ? lastBatchResults.length : 0,
  });
};
