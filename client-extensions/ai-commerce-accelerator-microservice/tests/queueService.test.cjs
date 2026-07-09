const { QueueService } = require('../services/queueService.cjs');

describe('QueueService - Hardening & Persistence', () => {
  let queueService;
  let mockCtx;
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      saveQueueJob: vi.fn(),
      getPendingQueueJobs: vi.fn().mockReturnValue([
        { id: 'job-1', queue: 'data-generation', priority: 0 },
        { id: 'job-2', queue: 'data-generation', priority: 10 },
      ]),
    };

    mockCtx = {
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
      cache: {
        set: vi.fn(),
        get: vi.fn(),
      },
      config: {
        getQueueConfigCached: vi.fn().mockReturnValue({}),
      },
      persistence: mockPersistence,
    };

    // Instantiate with mockCtx containing persistence
    queueService = new QueueService(mockCtx);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

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

    // Trigger loadPersistedJobs again with the same jobs
    queueService.loadPersistedJobs();

    // The length of jobs in the queue should remain unchanged (deduplicated)
    expect(queue.jobs.length).toBe(initialCount);
  });
});
