const { estimateTokens } = require('../utils/tokenEstimator.cjs');

describe('tokenEstimator', () => {
  it('should return 0 for empty or invalid inputs', () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(123)).toBe(0);
  });

  // This is the first call that actually needs the tokenizer - the test above
  // returns before loading it - so it pays for reading the whole cl100k_base
  // rank table. That is several seconds on a loaded machine and has nothing to
  // do with what is being asserted, so it gets its own timeout rather than
  // failing the suite at the default five.
  it('should estimate tokens exactly using BPE tokenizer', () => {
    // "Hello world" is exactly 2 tokens in cl100k_base
    expect(estimateTokens('Hello world')).toBe(2);
    expect(estimateTokens('This is a test sentence.')).toBe(6);
  }, 30000);

  it('should fallback to heuristic if tokenizer throws', () => {
    const text = 'Hello world how are you';
    expect(estimateTokens(text, 'invalid-model')).toBe(7);
  });
});
