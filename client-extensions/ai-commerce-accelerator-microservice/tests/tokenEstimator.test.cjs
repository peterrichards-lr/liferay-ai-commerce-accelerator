const { estimateTokens } = require('../utils/tokenEstimator.cjs');

describe('tokenEstimator', () => {
  it('should return 0 for empty or invalid inputs', () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(123)).toBe(0);
  });

  it('should estimate tokens exactly using BPE tokenizer', () => {
    // "Hello world" is exactly 2 tokens in cl100k_base
    expect(estimateTokens('Hello world')).toBe(2);
    expect(estimateTokens('This is a test sentence.')).toBe(6);
  });

  it('should fallback to heuristic if tokenizer throws', () => {
    const text = 'Hello world how are you';
    expect(estimateTokens(text, 'invalid-model')).toBe(7);
  });
});
