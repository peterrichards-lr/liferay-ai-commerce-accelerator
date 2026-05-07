const ConfigService = require('../services/configService.cjs');
const { QueueService } = require('../services/queueService.cjs');
const PersistenceService = require('../services/persistenceService.cjs');
const ProgressService = require('../services/progressService.cjs');

describe('Service Integrity', () => {
  const mockCtx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    cache: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
    persistence: {},
    ws: { clients: new Set() },
  };

  it('should ensure ConfigService has required methods', () => {
    const service = new ConfigService(mockCtx);
    const required = [
      'getAIKey',
      'getAIKeyCached',
      'getAIMediaKey',
      'getAIMediaKeyCached',
      'getAIConfig',
      'syncEnvironmentKeys',
    ];
    required.forEach((m) => {
      expect(typeof service[m], `ConfigService missing ${m}`).toBe('function');
    });
  });

  it('should ensure QueueService has required methods', () => {
    const service = new QueueService(mockCtx);
    const required = [
      'createQueue',
      'add',
      'getNextJob',
      'processJob',
      'loadPersistedJobs',
    ];
    required.forEach((m) => {
      expect(typeof service[m], `QueueService missing ${m}`).toBe('function');
    });
  });

  it('should ensure PersistenceService has required methods', () => {
    const service = new PersistenceService(mockCtx);
    const required = [
      'createSession',
      'getSession',
      'updateSessionStatus',
      'createBatch',
      'getBatchesForSession',
    ];
    required.forEach((m) => {
      expect(typeof service[m], `PersistenceService missing ${m}`).toBe(
        'function'
      );
    });
  });

  it('should ensure ProgressService has required methods', () => {
    const service = new ProgressService(mockCtx);
    const required = [
      'sessionStarted',
      'sessionCompleted',
      'stepStarted',
      'stepCompleted',
      'stepProgress',
    ];
    required.forEach((m) => {
      expect(typeof service[m], `ProgressService missing ${m}`).toBe(
        'function'
      );
    });
  });
});
