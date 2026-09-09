const {
  DEFAULT_MAX_TOKENS,
  requestOptions,
  resolveMaxTokens,
} = require('../utils/aiRequestOptions.cjs');

describe('requestOptions', () => {
  // getRuntimeAIConfig resolved requestTimeoutMs, returned it, and spread it
  // into the provider's options — and neither provider ever read it. The
  // setting appeared to work while doing nothing, and the SDK's own default
  // applied instead (#762).
  it('passes a configured timeout to the SDK', () => {
    expect(requestOptions({ requestTimeoutMs: 60000 })).toEqual({
      timeout: 60000,
    });
  });

  // Anything non-positive means "no explicit timeout", not "give up at once".
  // Sending timeout: 0 would abort every request instantly.
  it('sends no timeout rather than a zero one', () => {
    expect(requestOptions({ requestTimeoutMs: 0 })).toEqual({});
    expect(requestOptions({ requestTimeoutMs: -1 })).toEqual({});
  });

  it('sends nothing when none is configured', () => {
    expect(requestOptions({})).toEqual({});
    expect(requestOptions()).toEqual({});
  });

  it('ignores a value that is not a number', () => {
    expect(requestOptions({ requestTimeoutMs: 'soon' })).toEqual({});
    expect(requestOptions({ requestTimeoutMs: null })).toEqual({});
    expect(requestOptions({ requestTimeoutMs: Infinity })).toEqual({});
  });

  it('accepts a timeout Liferay sent as a string', () => {
    expect(requestOptions({ requestTimeoutMs: '30000' })).toEqual({
      timeout: 30000,
    });
  });
});

describe('resolveMaxTokens', () => {
  // The cap used to be resolved by comparing the configured value against
  // 4000 - the value the product shipped with - and substituting 16384 when
  // they matched. A configured 4000 therefore meant 16384, and raising the
  // panel from 4000 to 8000 halved the real cap because 8000 was no longer
  // the magic value (#823).
  it('sends a configured cap unchanged, including the shipped default', () => {
    expect(resolveMaxTokens(4000)).toBe(4000);
    expect(resolveMaxTokens(8000)).toBe(8000);
    expect(resolveMaxTokens(2000)).toBe(2000);
  });

  it('falls back only when nothing is configured', () => {
    expect(resolveMaxTokens(undefined)).toBe(DEFAULT_MAX_TOKENS);
    expect(resolveMaxTokens(null)).toBe(DEFAULT_MAX_TOKENS);
    expect(resolveMaxTokens()).toBe(DEFAULT_MAX_TOKENS);
  });

  // Liferay returns configuration values as strings.
  it('accepts a cap stored as a string', () => {
    expect(resolveMaxTokens('8000')).toBe(8000);
  });

  // max_tokens: 0 is rejected by both providers, so an operator who cleared
  // the field would otherwise fail every request in the run.
  it('treats a cleared or unusable value as unconfigured', () => {
    expect(resolveMaxTokens(0)).toBe(DEFAULT_MAX_TOKENS);
    expect(resolveMaxTokens(-1)).toBe(DEFAULT_MAX_TOKENS);
    expect(resolveMaxTokens('')).toBe(DEFAULT_MAX_TOKENS);
    expect(resolveMaxTokens('lots')).toBe(DEFAULT_MAX_TOKENS);
    expect(resolveMaxTokens(Infinity)).toBe(DEFAULT_MAX_TOKENS);
  });

  it('sends an integer, since a fractional cap is not a token count', () => {
    expect(resolveMaxTokens(8000.7)).toBe(8000);
  });
});
