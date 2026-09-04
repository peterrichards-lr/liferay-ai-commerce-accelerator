const {
  resolveValidationContext,
  validateGenerationRequest,
} = require('../utils/validateGenerationRequest.cjs');
const { validateInput } = require('../middleware/securityMiddleware.cjs');
const { MEDIA_MODES } = require('../utils/schemas.cjs');

const CONTEXT = {
  limits: { maxProducts: 10000, maxAccounts: 5000, maxOrders: 50000 },
  batchSizes: [10, 25, 50],
  aiModelOptions: [{ value: 'gpt-4o-mini' }, { value: 'claude-opus-5' }],
};

const request = (options) => ({ config: { catalogId: 1 }, options });

describe('generation request validation', () => {
  describe('defects in the shared validator', () => {
    it('enforces min: 0, which truthiness previously skipped', () => {
      // `if (rules.min && ...)` treated 0 as absent, so negatives passed.
      expect(
        validateInput({ n: -1 }, { n: { type: 'number', min: 0 } })
      ).toEqual(['n must be at least 0']);
    });

    it('enforces an enum on a number, not only on a string', () => {
      // batchSize declares a numeric enum; it was only checked for strings.
      expect(
        validateInput({ n: 7 }, { n: { type: 'number', enum: [10, 25] } })
      ).toEqual(['n must be one of: 10, 25']);
    });

    it('still accepts a value at the boundary', () => {
      expect(
        validateInput({ n: 0 }, { n: { type: 'number', min: 0, max: 10 } })
      ).toEqual([]);
    });
  });

  describe('media modes', () => {
    it('accepts the values the UI actually offers', () => {
      // The previous enum was none/generate/custom/default, which would have
      // rejected 'ai' - the primary case - and 'placeholder'.
      for (const mode of ['none', 'placeholder', 'ai']) {
        expect(MEDIA_MODES).toContain(mode);
        expect(
          validateGenerationRequest(
            'data',
            request({ imageMode: mode }),
            CONTEXT
          )
        ).toEqual([]);
      }
    });

    it('rejects a mode that is not offered', () => {
      expect(
        validateGenerationRequest(
          'data',
          request({ imageMode: 'nope' }),
          CONTEXT
        )
      ).toEqual([expect.stringContaining('imageMode must be one of')]);
    });
  });

  describe('counts', () => {
    it('accepts a run far above the old hardcoded ceiling', () => {
      // The schema said 100; the configured limit is 10000. Enforcing the
      // schema value would have rejected runs the product permits.
      expect(
        validateGenerationRequest(
          'data',
          request({ productCount: 5000 }),
          CONTEXT
        )
      ).toEqual([]);
    });

    it('rejects a run above the configured limit', () => {
      expect(
        validateGenerationRequest(
          'data',
          request({ productCount: 20000 }),
          CONTEXT
        )
      ).toEqual(['productCount must be at most 10000']);
    });

    it('rejects a negative count', () => {
      expect(
        validateGenerationRequest(
          'data',
          request({ accountCount: -5 }),
          CONTEXT
        )
      ).toEqual(['accountCount must be at least 0']);
    });

    it('imposes no ceiling when limits are unreadable', () => {
      // A configuration failure must not start rejecting work that used to run.
      expect(
        validateGenerationRequest('data', request({ productCount: 999999 }), {
          ...CONTEXT,
          limits: {},
        })
      ).toEqual([]);
    });
  });

  describe('model and batch size', () => {
    it('rejects a model that is not configured', () => {
      expect(
        validateGenerationRequest(
          'data',
          request({ aiModel: 'gpt-9' }),
          CONTEXT
        )
      ).toEqual([expect.stringContaining('aiModel must be one of')]);
    });

    it('rejects a batch size that is not offered', () => {
      expect(
        validateGenerationRequest('data', request({ batchSize: 7 }), CONTEXT)
      ).toEqual(['batchSize must be one of: 10, 25, 50']);
    });
  });

  describe('requiredness', () => {
    it('does not demand fields the callers may omit', () => {
      // imageMode and pdfMode are declared required, but the MCP tool does not
      // send them. Enforcing that would reject working requests.
      expect(validateGenerationRequest('data', request({}), CONTEXT)).toEqual(
        []
      );
    });
  });

  describe('resolveValidationContext', () => {
    it('degrades to permissive values when configuration cannot be read', () => {
      const failing = {
        getGenerationLimits: () => Promise.reject(new Error('down')),
        getBatchSizes: () => Promise.reject(new Error('down')),
        getAIModelOptions: () => Promise.reject(new Error('down')),
      };

      return resolveValidationContext(failing, {}).then((context) => {
        expect(context).toEqual({
          limits: {},
          batchSizes: [],
          aiModelOptions: [],
        });
      });
    });

    it('tolerates a configService that is absent entirely', () =>
      resolveValidationContext(undefined, {}).then((context) => {
        expect(context.limits).toEqual({});
      }));
  });
});
