const BaseGenerator = require('../generators/baseGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

describe('BaseGenerator', () => {
  let generator;
  let mockCtx;
  let persistence;

  beforeEach(() => {
    persistence = new PersistenceService(':memory:');

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
          initialDelayMs: 5000,
          maxRetries: 5,
          multiplier: 2,
        }),
      },
      liferay: {
        getCountries: vi.fn().mockResolvedValue([{ id: 1, name: 'US' }]),
        getLanguages: vi
          .fn()
          .mockResolvedValue([{ id: 'en-US', markedAsDefault: true }]),
      },
      progress: {
        sessionStarted: vi.fn(),
        batchStarted: vi.fn(),
      },
      batchCallback: {
        _checkSessionCompletion: vi.fn(),
      },
    };

    // Instantiate BaseGenerator directly for testing (it's technically abstract)
    generator = new BaseGenerator(mockCtx);
  });

  afterEach(() => {
    persistence.close();
  });

  describe('runWorkflow', () => {
    it('should initialize a session and report progress', async () => {
      const config = { correlationId: 'test-cid' };
      const options = { productCount: 5 };
      const steps = [{ name: 'step1', type: 'sync' }];
      const totals = { products: 5 };

      const result = await generator.runWorkflow(
        config,
        options,
        'test-flow',
        steps,
        totals
      );

      expect(result.sessionId).toBeDefined();
      expect(result.message).toContain('test-flow');

      const session = persistence.getSession(result.sessionId);
      expect(session).not.toBeNull();
      expect(session.flow_type).toBe('test-flow');
      expect(session.correlationId).toBe('test-cid');

      expect(mockCtx.progress.sessionStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: result.sessionId,
          flowType: 'test-flow',
          totalSteps: 1,
          totals: { products: 5 },
        })
      );
    });

    it('should fall back to default language if none provided', async () => {
      const config = { defaultLanguageId: 'en_US' };
      const options = {};
      const steps = [];

      await generator.runWorkflow(config, options, 'test-flow', steps, {});

      expect(options.selectedLanguages).toEqual(['en_US']);
    });
  });

  describe('Metadata Steps', () => {
    it('_runLoadCountriesStep should fetch and persist countries', async () => {
      const sessionId = 'test-session';
      persistence.createSession({
        sessionId,
        flowType: 'test',
        status: 'STARTED',
        context: { config: {} },
      });

      await generator._runLoadCountriesStep(sessionId);

      const session = persistence.getSession(sessionId);
      expect(session.context.countries).toHaveLength(1);
      expect(session.context.countries[0].name).toBe('US');
      expect(mockCtx.liferay.getCountries).toHaveBeenCalled();
    });

    it('_runLoadLanguagesStep should fetch and persist languages', async () => {
      const sessionId = 'test-session';
      persistence.createSession({
        sessionId,
        flowType: 'test',
        status: 'STARTED',
        context: { config: {} },
      });

      await generator._runLoadLanguagesStep(sessionId);

      const session = persistence.getSession(sessionId);
      expect(session.context.languages).toHaveLength(1);
      expect(session.context.languages[0].id).toBe('en-US');
      expect(mockCtx.liferay.getLanguages).toHaveBeenCalled();
    });
  });

  describe('Sync Delay', () => {
    it('_runInterServiceSyncDelayStep should complete after delay', async () => {
      const sessionId = 'test-session';
      persistence.createSession({
        sessionId,
        flowType: 'test',
        status: 'STARTED',
        context: { config: {} },
      });

      // Spy on completeSyncStep (inherited from BaseWorkflowService)
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
        context: { config: {} },
      });

      // Mock config to return specific backoff params
      mockCtx.config.getWorkflowResilienceConfigCached = vi
        .fn()
        .mockReturnValue({
          initialDelayMs: 10,
          maxRetries: 3,
          multiplier: 2,
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
        context: { config: {} },
      });

      mockCtx.config.getWorkflowResilienceConfigCached = vi
        .fn()
        .mockReturnValue({
          initialDelayMs: 5,
          maxRetries: 2,
          multiplier: 2,
        });

      const spy = vi.spyOn(generator, 'completeSyncStep').mockResolvedValue();
      const checkFn = vi.fn().mockResolvedValue(false); // Never succeeds

      await generator._runAdaptiveSyncDelayStep(
        sessionId,
        'fail-step',
        checkFn
      );

      expect(checkFn).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(
        sessionId,
        'fail-step',
        'SYNCHRONOUS',
        0,
        1
      );
      expect(mockCtx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('finished without meeting condition'),
        expect.anything()
      );
    });
  });

  describe('Verification', () => {
    it('verifySteps should throw if a handler is missing', () => {
      generator.steps = {
        'valid-step': () => {},
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
