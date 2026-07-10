const { QueueService } = require('../services/queueService.cjs');
const { logger } = require('../utils/logger.cjs');
const crypto = require('crypto');
const { Worker } = require('node:worker_threads');

describe('QueueService - Hardening, Persistence & Worker Loops', () => {
  let queueService;
  let mockCtx;
  let mockPersistence;
  let mockLogger;
  let mockCache;
  let mockConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn(),
      success: vi.fn(),
    };

    mockCache = {
      set: vi.fn(),
      get: vi.fn(),
    };

    mockConfig = {
      getQueueConfigCached: vi.fn().mockReturnValue({
        concurrency: 4,
        maxRetries: 3,
      }),
      getQueueConfig: vi.fn(),
    };

    mockPersistence = {
      saveQueueJob: vi.fn(),
      deleteQueueJob: vi.fn(),
      getPendingQueueJobs: vi.fn().mockReturnValue([
        { id: 'job-1', queue: 'data-generation', priority: 0 },
        { id: 'job-2', queue: 'data-generation', priority: 10 },
      ]),
      db: { name: 'test.db' },
    };

    mockCtx = {
      logger: mockLogger,
      cache: mockCache,
      config: mockConfig,
      persistence: mockPersistence,
    };

    queueService = new QueueService(mockCtx);
  });

  afterEach(async () => {
    if (queueService?.backgroundWorker) {
      await queueService.backgroundWorker.terminate();
    }
    vi.restoreAllMocks();
  });

  describe('Initialization & Persistence Loading', () => {
    it('should correctly receive and store persistence dependency', () => {
      expect(queueService.persistence).toBe(mockPersistence);
    });

    it('should load persisted jobs on startup', () => {
      expect(mockPersistence.getPendingQueueJobs).toHaveBeenCalled();
      expect(queueService.jobs.has('job-1')).toBe(true);
      expect(queueService.jobs.has('job-2')).toBe(true);
    });

    it('should deduplicate jobs during loadPersistedJobs to prevent double insertion', () => {
      const queue = queueService.queues.get('data-generation');
      const initialCount = queue.jobs.length;

      queueService.loadPersistedJobs();

      expect(queue.jobs.length).toBe(initialCount);
    });

    it('should handle startup failures during loadPersistedJobs gracefully', () => {
      mockPersistence.getPendingQueueJobs.mockImplementationOnce(() => {
        throw new Error('Database locked');
      });

      const newService = new QueueService(mockCtx);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load persisted jobs',
        expect.objectContaining({ error: 'Database locked' })
      );
    });
  });

  describe('Config Management & Remotes', () => {
    it('should apply valid config object via applyConfig', () => {
      queueService.applyConfig({
        concurrency: 5,
        maxRetries: 10,
        defaults: {
          jobTimeout: 400000,
        },
      });

      expect(queueService.config.defaults.concurrency).toBe(5);
      expect(queueService.config.defaults.maxRetries).toBe(10);
      expect(queueService.config.defaults.jobTimeout).toBe(400000);
    });

    it('should apply configuration from a valid JSON string', () => {
      queueService.applyConfig(
        JSON.stringify({
          concurrency: 8,
          queues: {
            'custom-queue': { concurrency: 12 },
          },
        })
      );

      expect(queueService.config.defaults.concurrency).toBe(8);
      expect(queueService.config.byQueue['custom-queue'].concurrency).toBe(12);
    });

    it('should ignore invalid configuration inputs safely', () => {
      const originalConcurrency = queueService.config.defaults.concurrency;

      queueService.applyConfig(null);
      queueService.applyConfig('invalid-json{');
      queueService.applyConfig(12345);

      expect(queueService.config.defaults.concurrency).toBe(
        originalConcurrency
      );
    });

    it('should refresh configuration from remote config service', async () => {
      mockConfig.getQueueConfig.mockResolvedValue({ concurrency: 9 });
      queueService.config.getQueueConfig = mockConfig.getQueueConfig;

      await queueService.refreshConfigFromRemote({ requestHeader: 'abc' });

      expect(mockConfig.getQueueConfig).toHaveBeenCalledWith({
        requestHeader: 'abc',
      });
      expect(queueService.config.defaults.concurrency).toBe(9);
    });

    it('should log warning if remote config fetch throws an error', async () => {
      mockConfig.getQueueConfig.mockRejectedValue(
        new Error('Connection timeout')
      );
      queueService.config.getQueueConfig = mockConfig.getQueueConfig;

      await queueService.refreshConfigFromRemote({});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed to refresh config'),
        expect.any(Object)
      );
    });
  });

  describe('Queue Operations & Stats', () => {
    it('should resolve and merge overrides correctly in resolveQueueOptions', () => {
      queueService.applyConfig({
        defaults: { concurrency: 2, maxRetries: 3 },
        queues: {
          'test-queue': { concurrency: 5 },
        },
      });

      const options = queueService.resolveQueueOptions('test-queue', {
        maxRetries: 7,
      });

      expect(options.concurrency).toBe(5);
      expect(options.retries).toBe(7);
    });

    it('should create a queue using createQueue', () => {
      const queue = queueService.createQueue('test-queue', { concurrency: 6 });

      expect(queueService.queues.has('test-queue')).toBe(true);
      expect(queue.concurrency).toBe(6);
      expect(queue.jobs).toEqual([]);
    });

    it('should generate statistics for a specific queue', async () => {
      const queue = queueService.queues.get('data-generation');
      queue.jobs = [
        { id: '1', status: 'waiting' },
        { id: '2', status: 'active' },
        { id: '3', status: 'completed' },
      ];
      queue.processing = 1;

      const stats = await queueService.getQueueStats('data-generation');
      expect(stats).toEqual({
        name: 'data-generation',
        waiting: 1,
        active: 1,
        completed: 1,
        failed: 0,
        processing: 1,
        concurrency: queue.concurrency,
      });
    });

    it('should fetch stats for all registered queues', async () => {
      const stats = await queueService.getAllStats();
      expect(stats['data-generation']).toBeDefined();
      expect(stats['batch-callback']).toBeDefined();
    });
  });

  describe('Job Seeding & Processing Lifecycle', () => {
    it('should successfully add a waiting job to queue via add()', async () => {
      const job = await queueService.add(
        'data-generation',
        'generate-product',
        { sku: 'SKU1' },
        { priority: 5, delay: 5000 }
      );

      expect(job.status).toBe('waiting');
      expect(job.priority).toBe(5);
      expect(job.runAt).toBeInstanceOf(Date);
      expect(mockPersistence.saveQueueJob).toHaveBeenCalledWith(job);
      expect(mockCache.set).toHaveBeenCalledWith(
        `job:${job.id}`,
        job,
        queueService.config.defaults.jobTTL
      );
    });

    it('should throw an error if queueName does not exist', async () => {
      await expect(
        queueService.add('non-existent-queue', 'generate-product', {})
      ).rejects.toThrow("Queue 'non-existent-queue' not found");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should retrieve job from cache if present', async () => {
      const mockJob = { id: 'job-cached', status: 'completed' };
      mockCache.get.mockReturnValue(mockJob);

      const job = await queueService.getJob('job-cached');
      expect(job).toEqual(mockJob);
    });

    it('should fall back to local jobs map if not cached', async () => {
      const mockJob = { id: 'job-local', status: 'waiting' };
      queueService.jobs.set('job-local', mockJob);
      mockCache.get.mockReturnValue(null);

      const job = await queueService.getJob('job-local');
      expect(job).toEqual(mockJob);
    });

    it('should return null if job is nowhere to be found', async () => {
      const job = await queueService.getJob('non-existent');
      expect(job).toBeNull();
    });

    it('should filter ready wait-state jobs correctly in getNextJob', () => {
      const queue = queueService.queues.get('data-generation');
      const now = new Date();

      queue.jobs = [
        { id: 'j1', status: 'active' },
        {
          id: 'j2',
          status: 'waiting',
          runAt: new Date(now.getTime() + 100000),
        },
        { id: 'j3', status: 'waiting', runAt: new Date(now.getTime() - 1000) },
      ];

      const nextJob = queueService.getNextJob(queue);
      expect(nextJob.id).toBe('j3');
    });

    it('should register a worker and process a job successfully', async () => {
      const processor = vi.fn().mockResolvedValue('success-result');
      queueService.registerWorker('generate-product', processor);

      const job = {
        id: 'job-active',
        type: 'generate-product',
        data: { sku: 'SKU1' },
        status: 'waiting',
        attempts: 0,
        maxAttempts: 2,
        timeout: 30000,
      };

      const queue = queueService.queues.get('data-generation');
      queue.jobs.push(job);

      await queueService.processJob(job, queue);

      expect(processor).toHaveBeenCalledWith(
        { sku: 'SKU1' },
        expect.any(Object)
      );
      expect(job.status).toBe('completed');
      expect(job.result).toBe('success-result');
      expect(job.progress).toBe(100);
    });

    it('should fail a job if worker throws an error', async () => {
      const processor = vi.fn().mockRejectedValue(new Error('AI failed'));
      queueService.registerWorker('generate-product', processor);

      const job = {
        id: 'job-failed',
        type: 'generate-product',
        data: {},
        status: 'waiting',
        attempts: 0,
        maxAttempts: 1, // permanent failure
        timeout: 30000,
      };

      const queue = queueService.queues.get('data-generation');
      queue.jobs.push(job);

      await queueService.processJob(job, queue);

      expect(job.status).toBe('failed');
      expect(job.error).toBe('AI failed');
    });

    it('should fail a job if no worker is registered for job type', async () => {
      const job = {
        id: 'job-no-worker',
        type: 'unregistered-type',
        data: {},
        status: 'waiting',
        attempts: 0,
        maxAttempts: 1,
        timeout: 30000,
      };
      const queue = queueService.queues.get('data-generation');
      queue.jobs.push(job);

      await queueService.processJob(job, queue);

      expect(job.status).toBe('failed');
      expect(job.error).toContain('No processor found');
    });

    it('should retry a failed job if attempts < maxAttempts', async () => {
      const processor = vi.fn().mockRejectedValue(new Error('Transient error'));
      queueService.registerWorker('generate-product', processor);

      const job = {
        id: 'job-retry',
        type: 'generate-product',
        data: {},
        status: 'waiting',
        attempts: 0,
        maxAttempts: 3,
        timeout: 30000,
      };

      const queue = queueService.queues.get('data-generation');
      queue.jobs.push(job);

      await queueService.processJob(job, queue);

      expect(job.status).toBe('waiting');
      expect(job.attempts).toBe(1);
      expect(job.runAt).toBeInstanceOf(Date);
    });

    it('should update progress of a running job via updateJobProgress', () => {
      const job = { id: 'job-progress', progress: 0 };
      queueService.updateJobProgress(job, 45);

      expect(job.progress).toBe(45);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Job progress updated',
        expect.any(Object)
      );
    });
  });

  describe('Cleanup Routines', () => {
    it('should clean up completed and failed jobs past TTL in cleanupCompletedJobs', () => {
      const now = Date.now();
      const ttl = queueService.config.defaults.jobTTL;

      const job1 = {
        id: 'j1',
        status: 'completed',
        updatedAt: new Date(now - ttl - 1000),
      };
      const job2 = {
        id: 'j2',
        status: 'failed',
        updatedAt: new Date(now - ttl + 1000),
      };
      const job3 = {
        id: 'j3',
        status: 'active',
        updatedAt: new Date(now - ttl - 1000),
      };

      queueService.jobs.set('j1', job1);
      queueService.jobs.set('j2', job2);
      queueService.jobs.set('j3', job3);

      queueService.cleanupCompletedJobs();

      expect(queueService.jobs.has('j1')).toBe(false);
      expect(queueService.jobs.has('j2')).toBe(true);
      expect(queueService.jobs.has('j3')).toBe(true);
      expect(mockPersistence.deleteQueueJob).toHaveBeenCalledWith('j1');
    });
  });

  describe('Background Worker Integration', () => {
    it('should start worker thread on startup if persistence DB is named', () => {
      expect(queueService.backgroundWorker).toBeInstanceOf(Worker);
    });

    it('should reload pending jobs when background worker reports PENDING_JOBS message', () => {
      mockPersistence.getPendingQueueJobs.mockClear();
      queueService.backgroundWorker.emit('message', {
        type: 'PENDING_JOBS',
        count: 5,
      });

      expect(mockPersistence.getPendingQueueJobs).toHaveBeenCalled();
    });

    it('should log warning when background worker reports ERROR message', () => {
      queueService.backgroundWorker.emit('message', {
        type: 'ERROR',
        error: 'Disk read failed',
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Background worker thread error: Disk read failed'
        )
      );
    });

    it('should log error when background worker crashes', () => {
      queueService.backgroundWorker.emit(
        'error',
        new Error('OutOfMemoryException')
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Background worker thread crashed: OutOfMemoryException'
        )
      );
    });
  });
});
