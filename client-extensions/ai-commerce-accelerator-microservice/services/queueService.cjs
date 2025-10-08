const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger.cjs');
const { cacheService } = require('./cacheService.cjs');
const { delay, delayCall } = require('../utils/misc.cjs');

class QueueService {
  constructor() {
    this.queues = new Map();
    this.jobs = new Map();
    this.workers = new Map();
    this.defaultQueue = 'default';

    // Create default queues
    this.createQueue('data-generation', { concurrency: 2, retries: 3 });
    this.createQueue('pdf-generation', { concurrency: 1, retries: 2 });
    this.createQueue('notification', { concurrency: 5, retries: 1 });

    // Start processing
    this.startProcessing();
  }

  createQueue(name, options = {}) {
    const queueConfig = {
      name,
      concurrency: options.concurrency || 1,
      retries: options.retries || 3,
      retryDelay: options.retryDelay || 5000,
      timeout: options.timeout || 300000, // 5 minutes
      jobs: [],
      processing: 0,
      ...options,
    };

    this.queues.set(name, queueConfig);

    logger.info('Queue created', {
      operation: 'queue-create',
      queueName: name,
      concurrency: queueConfig.concurrency,
      retries: queueConfig.retries,
    });

    return queueConfig;
  }

  async add(queueName, jobType, data, options = {}) {
    const queue = this.queues.get(queueName || this.defaultQueue);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    const jobId = options.jobId || uuidv4();
    const job = {
      id: jobId,
      type: jobType,
      queue: queueName,
      data,
      status: 'waiting',
      priority: options.priority || 0,
      attempts: 0,
      maxAttempts: options.retries || queue.retries,
      createdAt: new Date(),
      updatedAt: new Date(),
      delay: options.delay || 0,
      timeout: options.timeout || queue.timeout,
      correlationId: options.correlationId,
      userId: options.userId,
      progress: 0,
      result: null,
      error: null,
    };

    // Add delay if specified
    if (job.delay > 0) {
      job.runAt = new Date(Date.now() + job.delay);
    }

    queue.jobs.push(job);
    this.jobs.set(jobId, job);

    // Sort by priority (higher number = higher priority)
    queue.jobs.sort((a, b) => b.priority - a.priority);

    logger.info('Job added to queue', {
      operation: 'job-add',
      jobId,
      jobType,
      queueName,
      priority: job.priority,
      correlationId: job.correlationId,
    });

    // Cache job for external access
    cacheService.set(`job:${jobId}`, job, 3600000); // 1 hour

    return job;
  }

  async getJob(jobId) {
    const job = this.jobs.get(jobId) || cacheService.get(`job:${jobId}`);
    return job;
  }

  async getQueueStats(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return null;

    const stats = {
      name: queueName,
      waiting: queue.jobs.filter((j) => j.status === 'waiting').length,
      active: queue.jobs.filter((j) => j.status === 'active').length,
      completed: queue.jobs.filter((j) => j.status === 'completed').length,
      failed: queue.jobs.filter((j) => j.status === 'failed').length,
      processing: queue.processing,
      concurrency: queue.concurrency,
    };

    return stats;
  }

  async getAllStats() {
    const stats = {};
    for (const queueName of this.queues.keys()) {
      stats[queueName] = await this.getQueueStats(queueName);
    }
    return stats;
  }

  startProcessing() {
    for (const [queueName, queue] of this.queues.entries()) {
      this.processQueue(queueName);
    }

    // Start periodic cleanup
    setInterval(() => this.cleanupCompletedJobs(), 300000); // 5 minutes
  }

  async processQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return;

    while (true) {
      try {
        // Check if we can process more jobs
        if (queue.processing >= queue.concurrency) {
          await delay(1000);
          continue;
        }

        // Find next job to process
        const job = this.getNextJob(queue);
        if (!job) {
          await delay(2000);
          continue;
        }

        // Start processing job
        this.processJob(job, queue);
      } catch (error) {
        logger.errorWithStack(error, {
          operation: 'queue-process-error',
          queueName,
        });
        await delay(5000);
      }
    }
  }

  getNextJob(queue) {
    const now = new Date();

    return queue.jobs.find(
      (job) => job.status === 'waiting' && (!job.runAt || job.runAt <= now)
    );
  }

  async processJob(job, queue) {
    queue.processing++;
    job.status = 'active';
    job.startedAt = new Date();
    job.attempts++;

    logger.info('Job started', {
      operation: 'job-start',
      jobId: job.id,
      jobType: job.type,
      queueName: job.queue,
      attempt: job.attempts,
      correlationId: job.correlationId,
    });

    const timeout = delayCall(
      this.failJob,
      job.timeout,
      this,
      job,
      new Error('Job timeout'),
      queue
    );

    try {
      const processor = this.getJobProcessor(job.type);
      if (!processor) {
        throw new Error(`No processor found for job type: ${job.type}`);
      }

      const result = await processor(job.data, {
        job,
        updateProgress: (progress) => this.updateJobProgress(job, progress),
      });

      clearTimeout(timeout);
      this.completeJob(job, result, queue);
    } catch (error) {
      clearTimeout(timeout);
      this.failJob(job, error, queue);
    }
  }

  completeJob(job, result, queue) {
    job.status = 'completed';
    job.result = result;
    job.completedAt = new Date();
    job.progress = 100;

    queue.processing--;

    // Remove from queue but keep in jobs map for history
    const index = queue.jobs.indexOf(job);
    if (index > -1) {
      queue.jobs.splice(index, 1);
    }

    logger.success('Job completed', {
      operation: 'job-complete',
      jobId: job.id,
      jobType: job.type,
      queueName: job.queue,
      duration: job.completedAt - job.startedAt,
      correlationId: job.correlationId,
    });

    // Update cache
    cacheService.set(`job:${job.id}`, job, 3600000);
  }

  failJob(job, error, queue) {
    job.error = error.message;
    job.failedAt = new Date();

    queue.processing--;

    if (job.attempts < job.maxAttempts) {
      // Retry with exponential backoff
      const delay = Math.min(
        queue.retryDelay * Math.pow(2, job.attempts - 1),
        300000
      );
      job.status = 'waiting';
      job.runAt = new Date(Date.now() + delay);

      logger.warn('Job failed, retrying', {
        operation: 'job-retry',
        jobId: job.id,
        jobType: job.type,
        queueName: job.queue,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        retryDelay: delay,
        error: error.message,
        correlationId: job.correlationId,
      });
    } else {
      job.status = 'failed';

      // Remove from queue
      const index = queue.jobs.indexOf(job);
      if (index > -1) {
        queue.jobs.splice(index, 1);
      }

      logger.error('Job failed permanently', {
        operation: 'job-failed',
        jobId: job.id,
        jobType: job.type,
        queueName: job.queue,
        attempts: job.attempts,
        error: error.message,
        correlationId: job.correlationId,
      });
    }

    // Update cache
    cacheService.set(`job:${job.id}`, job, 3600000);
  }

  updateJobProgress(job, progress) {
    job.progress = Math.max(0, Math.min(100, progress));
    job.updatedAt = new Date();

    logger.debug('Job progress updated', {
      operation: 'job-progress',
      jobId: job.id,
      progress: job.progress,
      correlationId: job.correlationId,
    });

    // Update cache
    cacheService.set(`job:${job.id}`, job, 3600000);
  }

  getJobProcessor(jobType) {
    // Job processors will be registered here
    const processors = this.workers.get(jobType);
    return processors;
  }

  registerWorker(jobType, processor) {
    this.workers.set(jobType, processor);

    logger.info('Worker registered', {
      operation: 'worker-register',
      jobType,
    });
  }

  cleanupCompletedJobs() {
    const cutoff = new Date(Date.now() - 3600000); // 1 hour ago
    let cleaned = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        job.updatedAt < cutoff
      ) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleanup completed jobs', {
        operation: 'job-cleanup',
        cleanedJobs: cleaned,
      });
    }
  }
}

// Create singleton instance
const queueService = new QueueService();

module.exports = { queueService, QueueService };
