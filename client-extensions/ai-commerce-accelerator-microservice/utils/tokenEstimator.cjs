const { getEncoding } = require('js-tiktoken');

let encoder = null;

function getEncoder() {
  if (!encoder) {
    encoder = getEncoding('cl100k_base');
  }
  return encoder;
}

/**
 * Exact token estimator using js-tiktoken BPE tokenizer.
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  try {
    return getEncoder().encode(text).length;
  } catch (err) {
    // Fallback to the classic heuristic if encoding fails
    const charBased = Math.ceil(text.length / 4.0);
    const wordCount = text.split(/\s+/).length;
    const wordBased = Math.ceil(wordCount * 1.3);
    return Math.max(charBased, wordBased);
  }
}

module.exports = {
  estimateTokens,
  _setEncoder: (val) => {
    encoder = val;
  },
};
