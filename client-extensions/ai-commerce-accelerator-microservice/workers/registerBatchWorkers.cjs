const { JOB_TYPES } = require('../utils/constants.cjs');

module.exports = function registerBatchWorkers({
  queue,
  logger,
  batchCallbackService,
}) {
  // Workers are registered globally to the QueueService instance.
  // The 'queue' parameter here is the QueueService instance.
  queue.registerWorker(
    JOB_TYPES.BATCH_CALLBACK_PROCESSING,
    async (data, { job }) => {
      const { batchERC, payload, correlationId, sessionId } = data;

      logger.info('Starting batch callback processing job', {
        correlationId,
        sessionId,
        operation: 'job-batch-callback-processing',
        jobId: job.id,
        batchERC,
        queue: job.queue,
      });

      // Delegate to internal implementation which throws if batch not found
      await batchCallbackService.processCallbackInternal(
        batchERC,
        payload,
        correlationId,
        sessionId
      );

      logger.info('Batch callback processing job completed', {
        correlationId,
        operation: 'job-batch-callback-processing',
        jobId: job.id,
        batchERC,
        queue: job.queue,
      });

      return { success: true };
    }
  );

  logger.info('Batch processing workers registered', {
    operation: 'workers-register',
    workers: [JOB_TYPES.BATCH_CALLBACK_PROCESSING],
  });
};
