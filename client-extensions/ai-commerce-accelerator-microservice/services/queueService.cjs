const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger.cjs');
const { cacheService } = require('./cacheService.cjs');
const { delay, delayCall, normalizeNumber } = require('../utils/misc.cjs');
const { QUEUE_CONFIG } = require('../utils/constants.cjs');

class QueueService {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.queues = new Map();
    this.jobs = new Map();
    this.workers = new Map();
    this.defaultQueue = 'default';
    this.config = {
      defaults: {
        concurrency: normalizeNumber(QUEUE_CONFIG.DEFAULT_CONCURRENCY, {
          min: 1,
          defaultValue: 2,
        }),
        maxRetries: normalizeNumber(QUEUE_CONFIG.MAX_RETRIES, {
          min: 1,
          defaultValue: 3,
        }),
        retryDelay: normalizeNumber(QUEUE_CONFIG.RETRY_DELAY, {
          min: 1000,
          defaultValue: 5000,
        }),
        jobTimeout: normalizeNumber(QUEUE_CONFIG.JOB_TIMEOUT, {
          min: 10000,
          defaultValue: 300000,
        }),
        cleanupInterval: normalizeNumber(QUEUE_CONFIG.CLEANUP_INTERVAL, {
          min: 60000,
          defaultValue: 300000,
        }),
        jobTTL: normalizeNumber(QUEUE_CONFIG.JOB_TTL, {
          min: 60000,
          defaultValue: 3600000,
        }),
      },
      byQueue: {},
    };
    const cfgSvc = this.ctx.configService;
    if (cfgSvc?.getQueueConfigCached) {
      const cached = cfgSvc.getQueueConfigCached();
      this.applyConfig(cached);
    }
    this.createQueue('data-generation');
    this.createQueue('pdf-generation', { concurrency: 1 });
    this.createQueue('notification', { concurrency: 5, retries: 1 });
    this.startProcessing();
  }

  applyConfig(input) {
    if (!input) return;
    let cfg = input;
    if (typeof input === 'string') {
      try {
        cfg = JSON.parse(input);
      } catch (_) {
        return;
      }
    }
    if (!cfg || typeof cfg !== 'object') return;
    const d = this.config.defaults;
    const nextDefaults = {
      concurrency: normalizeNumber(
        cfg.concurrency ?? cfg.defaults?.concurrency,
        { min: 1, defaultValue: d.concurrency }
      ),
      maxRetries: normalizeNumber(cfg.maxRetries ?? cfg.defaults?.maxRetries, {
        min: 1,
        defaultValue: d.maxRetries,
      }),
      retryDelay: normalizeNumber(cfg.retryDelay ?? cfg.defaults?.retryDelay, {
        min: 1000,
        defaultValue: d.retryDelay,
      }),
      jobTimeout: normalizeNumber(cfg.jobTimeout ?? cfg.defaults?.jobTimeout, {
        min: 10000,
        defaultValue: d.jobTimeout,
      }),
      cleanupInterval: normalizeNumber(
        cfg.cleanupInterval ?? cfg.defaults?.cleanupInterval,
        { min: 60000, defaultValue: d.cleanupInterval }
      ),
      jobTTL: normalizeNumber(cfg.jobTTL ?? cfg.defaults?.jobTTL, {
        min: 60000,
        defaultValue: d.jobTTL,
      }),
    };
    this.config.defaults = {
      concurrency: Math.max(d.concurrency, nextDefaults.concurrency),
      maxRetries: Math.max(d.maxRetries, nextDefaults.maxRetries),
      retryDelay: Math.max(d.retryDelay, nextDefaults.retryDelay),
      jobTimeout: Math.max(d.jobTimeout, nextDefaults.jobTimeout),
      cleanupInterval: Math.max(
        d.cleanupInterval,
        nextDefaults.cleanupInterval
      ),
      jobTTL: Math.max(d.jobTTL, nextDefaults.jobTTL),
    };
    const queuesCfg =
      cfg.queues && typeof cfg.queues === 'object' ? cfg.queues : {};
    for (const [name, qc] of Object.entries(queuesCfg)) {
      const current = this.config.byQueue[name] || {};
      const merged = {
        concurrency: normalizeNumber(qc.concurrency, {
          min: 1,
          defaultValue: current.concurrency ?? this.config.defaults.concurrency,
        }),
        maxRetries: normalizeNumber(qc.maxRetries, {
          min: 1,
          defaultValue: current.maxRetries ?? this.config.defaults.maxRetries,
        }),
        retryDelay: normalizeNumber(qc.retryDelay, {
          min: 1000,
          defaultValue: current.retryDelay ?? this.config.defaults.retryDelay,
        }),
        jobTimeout: normalizeNumber(qc.jobTimeout, {
          min: 10000,
          defaultValue: current.jobTimeout ?? this.config.defaults.jobTimeout,
        }),
        jobTTL: normalizeNumber(qc.jobTTL, {
          min: 60000,
          defaultValue: current.jobTTL ?? this.config.defaults.jobTTL,
        }),
      };
      this.config.byQueue[name] = {
        concurrency: Math.max(current.concurrency ?? 0, merged.concurrency),
        maxRetries: Math.max(current.maxRetries ?? 0, merged.maxRetries),
        retryDelay: Math.max(current.retryDelay ?? 0, merged.retryDelay),
        jobTimeout: Math.max(current.jobTimeout ?? 0, merged.jobTimeout),
        jobTTL: Math.max(current.jobTTL ?? 0, merged.jobTTL),
      };
    }
    logger?.debug?.('QueueService config applied', {
      defaults: this.config.defaults,
      byQueue: this.config.byQueue,
    });
  }

  async refreshConfigFromRemote(requestConfig) {
    const { configService } = this.ctx;
    if (!configService?.getQueueConfig) return;
    try {
      const remote = await configService.getQueueConfig(requestConfig);
      this.applyConfig(remote);
    } catch (e) {
      logger?.warn?.('QueueService: failed to refresh config', {
        error: String(e?.message || e),
      });
    }
  }

  resolveQueueOptions(name, overrides = {}) {
    const d = this.config.defaults;
    const q = this.config.byQueue[name] || {};
    return {
      name,
      concurrency: normalizeNumber(
        overrides.concurrency ?? q.concurrency ?? d.concurrency,
        { min: 1, defaultValue: d.concurrency }
      ),
      retries: normalizeNumber(
        overrides.retries ??
          overrides.maxRetries ??
          q.maxRetries ??
          d.maxRetries,
        { min: 1, defaultValue: d.maxRetries }
      ),
      retryDelay: normalizeNumber(
        overrides.retryDelay ?? q.retryDelay ?? d.retryDelay,
        { min: 1000, defaultValue: d.retryDelay }
      ),
      timeout: normalizeNumber(
        overrides.timeout ?? q.jobTimeout ?? d.jobTimeout,
        { min: 10000, defaultValue: d.jobTimeout }
      ),
      jobTTL: normalizeNumber(overrides.jobTTL ?? q.jobTTL ?? d.jobTTL, {
        min: 60000,
        defaultValue: d.jobTTL,
      }),
    };
  }

  createQueue(name, options = {}) {
    const cfg = this.resolveQueueOptions(name, options);
    const queueConfig = {
      name: cfg.name,
      concurrency: cfg.concurrency,
      retries: cfg.retries,
      retryDelay: cfg.retryDelay,
      timeout: cfg.timeout,
      jobTTL: cfg.jobTTL,
      jobs: [],
      processing: 0,
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
    if (!queue) throw new Error(`Queue '${queueName}' not found`);
    const jobId = options.jobId || uuidv4();
    const job = {
      id: jobId,
      type: jobType,
      queue: queue.name,
      data,
      status: 'waiting',
      priority: options.priority || 0,
      attempts: 0,
      maxAttempts: normalizeNumber(options.retries ?? queue.retries, {
        min: 1,
        defaultValue: queue.retries,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
      delay: normalizeNumber(options.delay || 0, { min: 0, defaultValue: 0 }),
      timeout: normalizeNumber(options.timeout ?? queue.timeout, {
        min: 10000,
        defaultValue: queue.timeout,
      }),
      correlationId: options.correlationId,
      userId: options.userId,
      progress: 0,
      result: null,
      error: null,
    };
    if (job.delay > 0) job.runAt = new Date(Date.now() + job.delay);
    queue.jobs.push(job);
    this.jobs.set(jobId, job);
    queue.jobs.sort((a, b) => b.priority - a.priority);
    logger.info('Job added to queue', {
      operation: 'job-add',
      jobId,
      jobType,
      queueName: queue.name,
      priority: job.priority,
      correlationId: job.correlationId,
    });
    cacheService.set(`job:${jobId}`, job, this.config.defaults.jobTTL);
    return job;
  }

  async getJob(jobId) {
    const job = this.jobs.get(jobId) || cacheService.get(`job:${jobId}`);
    return job;
  }

  async getQueueStats(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return null;
    return {
      name: queueName,
      waiting: queue.jobs.filter((j) => j.status === 'waiting').length,
      active: queue.jobs.filter((j) => j.status === 'active').length,
      completed: queue.jobs.filter((j) => j.status === 'completed').length,
      failed: queue.jobs.filter((j) => j.status === 'failed').length,
      processing: queue.processing,
      concurrency: queue.concurrency,
    };
  }

  async getAllStats() {
    const stats = {};
    for (const queueName of this.queues.keys()) {
      stats[queueName] = await this.getQueueStats(queueName);
    }
    return stats;
  }

  startProcessing() {
    for (const [queueName] of this.queues.entries()) {
      this.processQueue(queueName);
    }
    setInterval(
      () => this.cleanupCompletedJobs(),
      this.config.defaults.cleanupInterval
    );
  }

  async processQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return;
    while (true) {
      try {
        if (queue.processing >= queue.concurrency) {
          await delay(1000);
          continue;
        }
        const job = this.getNextJob(queue);
        if (!job) {
          await delay(2000);
          continue;
        }
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
      if (!processor)
        throw new Error(`No processor found for job type: ${job.type}`);
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
    const index = queue.jobs.indexOf(job);
    if (index > -1) queue.jobs.splice(index, 1);
    logger.success('Job completed', {
      operation: 'job-complete',
      jobId: job.id,
      jobType: job.type,
      queueName: job.queue,
      duration: job.completedAt - job.startedAt,
      correlationId: job.correlationId,
    });
    cacheService.set(`job:${job.id}`, job, this.config.defaults.jobTTL);
  }

  failJob(job, error, queue) {
    job.error = error.message;
    job.failedAt = new Date();
    queue.processing--;
    if (job.attempts < job.maxAttempts) {
      const base = normalizeNumber(queue.retryDelay, {
        min: 1000,
        defaultValue: this.config.defaults.retryDelay,
      });
      const delayMs = Math.min(base * Math.pow(2, job.attempts - 1), 300000);
      job.status = 'waiting';
      job.runAt = new Date(Date.now() + delayMs);
      logger.warn('Job failed, retrying', {
        operation: 'job-retry',
        jobId: job.id,
        jobType: job.type,
        queueName: job.queue,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        retryDelay: delayMs,
        error: error.message,
        correlationId: job.correlationId,
      });
    } else {
      job.status = 'failed';
      const index = queue.jobs.indexOf(job);
      if (index > -1) queue.jobs.splice(index, 1);
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
    cacheService.set(`job:${job.id}`, job, this.config.defaults.jobTTL);
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
    cacheService.set(`job:${job.id}`, job, this.config.defaults.jobTTL);
  }

  getJobProcessor(jobType) {
    return this.workers.get(jobType);
  }

  registerWorker(jobType, processor) {
    this.workers.set(jobType, processor);
    logger.info('Worker registered', { operation: 'worker-register', jobType });
  }

  cleanupCompletedJobs() {
    const ttl = this.config.defaults.jobTTL;
    const cutoff = new Date(Date.now() - ttl);
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

const queueService = new QueueService();
module.exports = { queueService, QueueService };
