const crypto = require('crypto');
const {
  delay,
  delayCall,
  normalizeNumber,
  tryParseJSON,
  createERC,
} = require('../utils/misc.cjs');
const { QUEUE_CONFIG, ERC_PREFIX } = require('../utils/constants.cjs');

function withErrorRef(err, operation) {
  if (err && err.errorReference) return err;
  const wrapped =
    err instanceof Error ? err : new Error(String(err || 'Error'));
  wrapped.errorReference = createERC(ERC_PREFIX.ERROR);
  wrapped.operation = operation;
  return wrapped;
}

const { Worker } = require('node:worker_threads');
const path = require('path');

class QueueService {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.logger = ctx.logger;
    this.cache = ctx.cache;
    this.config = ctx.config;
    this.persistence = ctx.persistence;

    this.queues = new Map();
    this.jobs = new Map();
    this.workers = new Map();
    this.defaultQueue = 'data-generation';

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

    if (this.config?.getQueueConfigCached) {
      const cached = this.config.getQueueConfigCached();
      this.applyConfig(cached);
    }

    this.createQueue('data-generation', { concurrency: 2 });
    this.createQueue('batch-callback', { concurrency: 10, retries: 5 });

    // Load pending jobs from persistence
    this.loadPersistedJobs();

    this.startProcessing();

    // SPARK: Separate background thread for monitoring
    this.startBackgroundWorker();
  }

  startBackgroundWorker() {
    if (!this.persistence?.db?.name) return; // Only if we have a file-based DB

    try {
      const workerPath = path.resolve(
        __dirname,
        '..',
        'workers/queueWorker.cjs'
      );
      this.backgroundWorker = new Worker(workerPath, {
        workerData: {
          dbPath: this.persistence.db.name,
          pollInterval: 3000,
        },
      });

      this.backgroundWorker.on('message', (msg) => {
        if (msg.type === 'PENDING_JOBS') {
          // Worker found work - ensure our local loops are active
          this.logger?.trace?.(
            `Background thread detected ${msg.count} pending jobs`
          );
          this.loadPersistedJobs();
        } else if (msg.type === 'ERROR') {
          this.logger?.warn?.(`Background worker thread error: ${msg.error}`);
        }
      });

      this.backgroundWorker.on('error', (err) => {
        this.logger?.error?.(
          `Background worker thread crashed: ${err.message}`
        );
      });

      this.logger?.info?.('Queue background monitoring thread started');
    } catch (err) {
      this.logger?.warn?.(
        `Failed to start background worker thread: ${err.message}`
      );
    }
  }

  loadPersistedJobs() {
    if (!this.persistence) return;

    try {
      const pending = this.persistence.getPendingQueueJobs();
      if (pending.length > 0) {
        this.logger?.info?.(`Loading ${pending.length} pending jobs from DB`, {
          operation: 'queue-load-persisted',
        });

        pending.forEach((job) => {
          if (!this.jobs.has(job.id)) {
            const queue = this.queues.get(job.queue);
            if (queue) {
              queue.jobs.push(job);
              this.jobs.set(job.id, job);
            }
          }
        });

        // Re-sort all queues by priority
        for (const queue of this.queues.values()) {
          queue.jobs.sort((a, b) => b.priority - a.priority);
        }
      }
    } catch (err) {
      this.logger?.error?.('Failed to load persisted jobs', {
        operation: 'queue-load-persisted',
        error: err.message,
      });
    }
  }

  applyConfig(input) {
    if (!input) return;

    let cfg = input;
    if (typeof cfg === 'string') {
      cfg = tryParseJSON(cfg, null);
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

    this.logger?.debug?.('QueueService config applied', {
      operation: 'queue-config-apply',
      defaults: this.config.defaults,
      byQueue: this.config.byQueue,
    });
  }

  async refreshConfigFromRemote(requestConfig) {
    if (!this.config?.getQueueConfig) return;
    try {
      const remote = await this.config.getQueueConfig(requestConfig);
      this.applyConfig(remote);
    } catch (e) {
      const err = withErrorRef(e, 'queue-config-refresh');
      this.logger?.warn?.('QueueService: failed to refresh config', {
        operation: 'queue-config-refresh',
        errorReference: err.errorReference,
        message: err.message,
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

    this.logger?.info?.('Queue created', {
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
      const err = withErrorRef(
        new Error(`Queue '${queueName}' not found`),
        'queue-add'
      );
      this.logger?.error?.('Failed to add job to queue', {
        operation: 'queue-add',
        queueName,
        jobType,
        errorReference: err.errorReference,
        message: err.message,
      });
      throw err;
    }

    const jobId = options.jobId || crypto.randomUUID();

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
      delay: normalizeNumber(options.delay || 0, {
        min: 0,
        defaultValue: 0,
      }),
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

    if (job.delay > 0) {
      job.runAt = new Date(Date.now() + job.delay);
    }

    queue.jobs.push(job);
    this.jobs.set(jobId, job);
    queue.jobs.sort((a, b) => b.priority - a.priority);

    // PERSISTENCE: Save job to DB
    if (this.persistence) {
      try {
        this.persistence.saveQueueJob(job);
      } catch (err) {
        this.logger?.error?.('Failed to persist job', {
          jobId,
          error: err.message,
        });
      }
    }

    this.logger?.info?.('Job added to queue', {
      operation: 'job-add',
      jobId,
      jobType,
      queueName: queue.name,
      priority: job.priority,
      correlationId: job.correlationId,
    });

    this.cache?.set(`job:${jobId}`, job, this.config.defaults.jobTTL);

    return job;
  }

  async getJob(jobId) {
    const cached = this.cache?.get(`job:${jobId}`);
    if (cached) return cached;
    return this.jobs.get(jobId) || null;
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
      this._loopQueue(queueName);
    }

    setInterval(
      () => this.cleanupCompletedJobs(),
      this.config.defaults.cleanupInterval
    );
  }

  async _loopQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return;

    while (true) {
      try {
        if (queue.processing >= queue.concurrency) {
          await delay(100);
          continue;
        }

        const job = this.getNextJob(queue);
        if (!job) {
          await delay(200);
          continue;
        }

        await this.processJob(job, queue);
      } catch (err) {
        const error = withErrorRef(err, 'queue-process-loop');

        this.logger?.error?.('Queue processing loop error', {
          operation: 'queue-process-loop',
          queueName,
          errorReference: error.errorReference,
          message: error.message,
          stack: error.stack,
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
    job.updatedAt = new Date();

    // PERSISTENCE: Update status in DB
    if (this.persistence) {
      try {
        this.persistence.saveQueueJob(job);
      } catch (err) {
        this.logger?.error?.('Failed to update job status in DB', {
          jobId: job.id,
          error: err.message,
        });
      }
    }

    this.logger?.info?.('Job started', {
      operation: 'job-start',
      jobId: job.id,
      jobType: job.type,
      queueName: job.queue,
      attempt: job.attempts,
      correlationId: job.correlationId,
    });

    const timeoutTimer = delayCall(
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

      clearTimeout(timeoutTimer);
      this.completeJob(job, result, queue);
    } catch (err) {
      clearTimeout(timeoutTimer);
      this.failJob(job, err, queue);
    }
  }

  completeJob(job, result, queue) {
    job.status = 'completed';
    job.result = result;
    job.completedAt = new Date();
    job.progress = 100;
    job.updatedAt = new Date();

    queue.processing--;

    const idx = queue.jobs.indexOf(job);
    if (idx > -1) queue.jobs.splice(idx, 1);

    // PERSISTENCE: Update completion in DB
    if (this.persistence) {
      try {
        this.persistence.saveQueueJob(job);
      } catch (err) {
        this.logger?.error?.('Failed to update job completion in DB', {
          jobId: job.id,
          error: err.message,
        });
      }
    }

    this.logger?.success?.('Job completed', {
      operation: 'job-complete',
      jobId: job.id,
      jobType: job.type,
      queueName: job.queue,
      duration: job.completedAt - job.startedAt,
      correlationId: job.correlationId,
    });

    this.cache?.set(`job:${job.id}`, job, this.config.defaults.jobTTL);
  }

  failJob(job, err, queue) {
    const error = withErrorRef(err, 'job-fail');

    job.error = error.message;
    job.failedAt = new Date();
    job.updatedAt = new Date();

    queue.processing--;

    if (job.attempts < job.maxAttempts) {
      const base = normalizeNumber(queue.retryDelay, {
        min: 1000,
        defaultValue: this.config.defaults.retryDelay,
      });

      const delayMs = Math.min(base * Math.pow(2, job.attempts - 1), 300000);

      job.status = 'waiting';
      job.runAt = new Date(Date.now() + delayMs);

      this.logger?.warn?.('Job failed, retrying', {
        operation: 'job-retry',
        jobId: job.id,
        jobType: job.type,
        queueName: job.queue,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        retryDelay: delayMs,
        errorReference: error.errorReference,
        error: error.message,
        correlationId: job.correlationId,
      });
    } else {
      job.status = 'failed';

      const idx = queue.jobs.indexOf(job);
      if (idx > -1) queue.jobs.splice(idx, 1);

      this.logger?.error?.('Job failed permanently', {
        operation: 'job-failed',
        jobId: job.id,
        jobType: job.type,
        queueName: job.queue,
        attempts: job.attempts,
        errorReference: error.errorReference,
        error: error.message,
        correlationId: job.correlationId,
      });
    }

    // PERSISTENCE: Update failure in DB
    if (this.persistence) {
      try {
        this.persistence.saveQueueJob(job);
      } catch (err) {
        this.logger?.error?.('Failed to update job failure in DB', {
          jobId: job.id,
          error: err.message,
        });
      }
    }

    this.cache?.set(`job:${job.id}`, job, this.config.defaults.jobTTL);
  }

  updateJobProgress(job, progress) {
    job.progress = Math.max(0, Math.min(100, progress));
    job.updatedAt = new Date();

    this.logger?.debug?.('Job progress updated', {
      operation: 'job-progress',
      jobId: job.id,
      progress: job.progress,
      correlationId: job.correlationId,
    });

    this.cache?.set(`job:${job.id}`, job, this.config.defaults.jobTTL);
  }

  getJobProcessor(jobType) {
    return this.workers.get(jobType);
  }

  registerWorker(jobType, processor) {
    this.workers.set(jobType, processor);

    this.logger?.info?.('Worker registered', {
      operation: 'worker-register',
      jobType,
    });
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
        // PERSISTENCE: Delete from DB
        if (this.persistence) {
          try {
            this.persistence.deleteQueueJob(jobId);
          } catch (_err) {
            // Silent
          }
        }
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger?.info?.('Cleanup completed jobs', {
        operation: 'job-cleanup',
        cleanedJobs: cleaned,
      });
    }
  }
}

function createQueueService(ctx = {}) {
  return new QueueService(ctx);
}

module.exports = {
  QueueService,
  createQueueService,
};
