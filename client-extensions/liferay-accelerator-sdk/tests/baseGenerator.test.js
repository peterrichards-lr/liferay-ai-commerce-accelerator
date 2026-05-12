const { BaseGenerator, PersistenceService, utils } = require('../src/index.js');
const { WORKFLOW_STEPS } = utils.constants;

describe('BaseGenerator', () => {
  let generator;
  let mockCtx;
  let persistence;

  beforeEach(() => {
    persistence = new PersistenceService(
      { logger: { info: vi.fn() } },
      ':memory:'
    );

    mockCtx = {
      persistence,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      config: {
        getExcludeLists: vi.fn().mockResolvedValue([]),
        getLiferaySyncDelayMs: vi.fn().mockReturnValue(0),
        getWorkflowResilienceConfigCached: vi.fn().mockReturnValue({
          initialDelayMs: 5,
          maxRetries: 3,
          multiplier: 2,
        }),
      },
      liferay: {
        getCountries: vi.fn().mockResolvedValue([{ id: 1, name: 'US' }]),
        getLanguages: vi
          .fn()
          .mockResolvedValue([{ id: 'en-US', markedAsDefault: true }]),
        getTaxonomyVocabularies: vi.fn().mockResolvedValue([]),
      },
      progress: {
        sessionStarted: vi.fn(),
        stepStarted: vi.fn(),
        stepCompleted: vi.fn(),
        sessionCompleted: vi.fn(),
        sessionFailed: vi.fn(),
      },
      batchCallback: {
        _checkSessionCompletion: vi.fn().mockResolvedValue(),
      },
    };

    generator = new BaseGenerator(mockCtx);
  });

  describe('runWorkflow', () => {
    it('should initialize a session and report progress', async () => {
      const config = { catalogId: 123 };
      const options = { productCount: 10 };
      const totals = { products: 5 };

      const result = await generator.runWorkflow(
        config,
        options,
        'test-flow',
        [],
        { totals }
      );

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(mockCtx.progress.sessionStarted).toHaveBeenCalled();
    });

    it('should fall back to default language if none provided', async () => {
      const config = {};
      const options = {};
      const steps = [];

      await generator.runWorkflow(config, options, 'test-flow', steps, {});

      // SDK uses hyphenated locales by default
      expect(options.selectedLanguages).toEqual(['en-US']);
    });
  });

  describe('Metadata Steps', () => {
    it('_runLoadCountriesStep should fetch and persist countries', async () => {
      const sessionId = 'test-session';
      persistence.createSession({
        sessionId,
        flowType: 'test',
        status: 'STARTED',
        currentSteps: [],
        correlationId: 'cid',
        context: { config: {} },
      });

      await generator._runLoadCountriesStep(sessionId);

      const session = persistence.getSession(sessionId);
      expect(session.context.countries).toBeDefined();
      expect(session.context.countries).toHaveLength(1);
    });

    it('_runLoadLanguagesStep should fetch and persist languages', async () => {
      const sessionId = 'lang-session';
      persistence.createSession({
        sessionId,
        flowType: 'test',
        status: 'STARTED',
        currentSteps: [],
        correlationId: 'cid',
        context: { config: {} },
      });

      await generator._runLoadLanguagesStep(sessionId);

      const session = persistence.getSession(sessionId);
      expect(session.context.languages).toBeDefined();
      expect(session.context.languages[0].id).toBe('en-US');
    });
  });

  describe('Sync Delay', () => {
    it('_runInterServiceSyncDelayStep should complete after delay', async () => {
      const sessionId = 'test-session';
      persistence.createSession({
        sessionId,
        flowType: 'test',
        status: 'STARTED',
        currentSteps: [],
        correlationId: 'cid',
        context: { config: {} },
      });

      // Spy on completeSyncStep
      const spy = vi.spyOn(generator, 'completeSyncStep').mockResolvedValue();

      await generator._runInterServiceSyncDelayStep(
        sessionId,
        WORKFLOW_STEPS.SYNC_DELAY
      );

      expect(spy).toHaveBeenCalledWith(sessionId, WORKFLOW_STEPS.SYNC_DELAY);
    });

    it('_runAdaptiveSyncDelayStep should retry with backoff and complete on success', async () => {
      const sessionId = 'adaptive-session';
      persistence.createSession({
        sessionId,
        flowType: 'test',
        status: 'STARTED',
        currentSteps: [],
        correlationId: 'cid',
        context: { config: {} },
      });

      const spy = vi.spyOn(generator, 'completeSyncStep').mockResolvedValue();

      let attempts = 0;
      const checkFn = vi.fn().mockImplementation(() => {
        attempts++;
        return attempts === 2; // Succeed on second attempt
      });

      await generator._runAdaptiveSyncDelayStep(
        sessionId,
        'test-step',
        checkFn
      );

      expect(checkFn).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(
        sessionId,
        'test-step',
        'SYNCHRONOUS',
        1,
        1
      );
    });

    it('_runAdaptiveSyncDelayStep should proceed even if max retries reached without success', async () => {
      const sessionId = 'fail-session';
      persistence.createSession({
        sessionId,
        flowType: 'test',
        status: 'STARTED',
        currentSteps: [],
        correlationId: 'cid',
        context: { config: {} },
      });

      const spy = vi.spyOn(generator, 'completeSyncStep').mockResolvedValue();
      const checkFn = vi.fn().mockResolvedValue(false); // Never succeeds

      await generator._runAdaptiveSyncDelayStep(
        sessionId,
        'fail-step',
        checkFn
      );

      expect(checkFn).toHaveBeenCalledTimes(3); // Based on mock resilience config
      expect(spy).toHaveBeenCalledWith(
        sessionId,
        'fail-step',
        'SYNCHRONOUS',
        0,
        1
      );
    });
  });

  describe('Verification', () => {
    it('verifySteps should throw if a handler is missing', () => {
      generator.steps = {
        'invalid-step': null,
      };

      expect(() => generator.verifySteps()).toThrow(
        "FATAL: Workflow Step 'invalid-step' in BaseGenerator has no valid method handler."
      );
    });

    it('verifySteps should pass if all handlers exist', () => {
      generator.steps = {
        'valid-step': () => {},
      };

      expect(() => generator.verifySteps()).not.toThrow();
    });
  });
});
