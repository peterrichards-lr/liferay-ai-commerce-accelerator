/**
 * The seven settings declared by #1068 reach the code that reads them.
 *
 * Each was read as `ENV.NAME` and declared nowhere, so it was permanently
 * `undefined` and every one of them silently took the fallback written beside
 * its read. The service behaved correctly; the setting simply could not be
 * configured, and nothing said so. That is the quiet half of #1063, where the
 * same defect had an error message attached and was therefore obvious.
 *
 * These assert both directions: unset still produces exactly what the old
 * fallback produced, so declaring them changed nothing for an existing
 * deployment; and a supplied value now arrives, which is the point.
 *
 * `PROMPTS_DIR` defaults to empty on purpose - `promptService` resolves
 * `envDir || cfgDir || 'prompts'`, so a non-empty default would shadow the
 * `promptsDir` an operator set in ai-config. That ordering is asserted rather
 * than described.
 */
function loadFresh(env = {}) {
  const previous = {};

  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  delete require.cache[require.resolve('../utils/constants.cjs')];

  try {
    return require('../utils/constants.cjs').ENV;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve('../utils/constants.cjs')];
  }
}

describe('settings declared by #1068', () => {
  describe('unset, they are the fallbacks the reads used to apply', () => {
    it.each([
      ['CACHE_MAX_SIZE', 10000],
      ['CACHE_DEFAULT_TTL', 3600000],
      ['CACHE_CLEANUP_INTERVAL', 60000],
      ['PROMPT_CACHE_TTL', 10 * 60 * 1000],
    ])('%s defaults to %i', (name, expected) => {
      expect(loadFresh({ [name]: undefined })[name]).toBe(expected);
    });

    it('PROMPT_CACHE_DISABLED defaults to false', () => {
      expect(
        loadFresh({ PROMPT_CACHE_DISABLED: undefined }).PROMPT_CACHE_DISABLED
      ).toBe(false);
    });

    it('PROMPTS_DIR defaults to empty, so ai-config still wins', () => {
      // A non-empty default here would take precedence over the operator's
      // own `promptsDir`, because the read is `envDir || cfgDir || 'prompts'`.
      expect(loadFresh({ PROMPTS_DIR: undefined }).PROMPTS_DIR).toBe('');
    });
  });

  describe('set, they now arrive', () => {
    it('takes a supplied cache size', () => {
      expect(loadFresh({ CACHE_MAX_SIZE: '250' }).CACHE_MAX_SIZE).toBe(250);
    });

    it('takes a supplied prompt directory', () => {
      expect(loadFresh({ PROMPTS_DIR: '/srv/prompts' }).PROMPTS_DIR).toBe(
        '/srv/prompts'
      );
    });

    it('takes a supplied prompt cache switch', () => {
      expect(
        loadFresh({ PROMPT_CACHE_DISABLED: 'true' }).PROMPT_CACHE_DISABLED
      ).toBe(true);
    });
  });

  describe('the minimums hold', () => {
    it('clamps a cache size below the floor rather than accepting it', () => {
      expect(loadFresh({ CACHE_MAX_SIZE: '1' }).CACHE_MAX_SIZE).toBe(100);
    });

    it('clamps a cleanup interval below the floor', () => {
      expect(
        loadFresh({ CACHE_CLEANUP_INTERVAL: '10' }).CACHE_CLEANUP_INTERVAL
      ).toBe(5000);
    });
  });
});
