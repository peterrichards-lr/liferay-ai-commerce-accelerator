const { requestOptions } = require('../utils/aiRequestOptions.cjs');

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
