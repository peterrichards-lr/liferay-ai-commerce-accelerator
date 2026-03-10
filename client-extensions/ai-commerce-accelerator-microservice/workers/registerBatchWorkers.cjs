const { JOB_TYPES } = require('../utils/constants.cjs');

module.exports = function registerBatchWorkers({
  queue,
  logger,
  batchCallbackService,
}) {
  queue.registerWorker(
    JOB_TYPES.BATCH_CALLBACK_PROCESSING,
    async (data, { job }) => {
      const { batchERC, payload, correlationId } = data;

      logger.info('Starting batch callback processing job', {
        correlationId,
        operation: 'job-batch-callback-processing',
        jobId: job.id,
        batchERC,
      });

      // Delegate to internal implementation which throws if batch not found
      await batchCallbackService.processCallbackInternal(
        batchERC,
        payload,
        correlationId
      );

      logger.info('Batch callback processing job completed', {
        correlationId,
        operation: 'job-batch-callback-processing',
        jobId: job.id,
        batchERC,
      });

      return { success: true };
    }
  );

  logger.info('Batch processing workers registered', {
    operation: 'workers-register',
    workers: [JOB_TYPES.BATCH_CALLBACK_PROCESSING],
  });
};
