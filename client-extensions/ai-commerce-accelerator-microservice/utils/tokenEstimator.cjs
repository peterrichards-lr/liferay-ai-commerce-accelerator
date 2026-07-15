const { encodingForModel } = require('js-tiktoken');

function estimateTokensHeuristic(text) {
  if (!text || typeof text !== 'string') return 0;
  const charBased = Math.ceil(text.length / 4.0);
  const wordCount = text.split(/\s+/).length;
  const wordBased = Math.ceil(wordCount * 1.3);
  return Math.max(charBased, wordBased);
}

/**
 * Pre-flight Token Estimator utility utilizing js-tiktoken BPE tokenization,
 * with a fallback heuristic on errors or unsupported models.
 */
function estimateTokens(text, model = 'gpt-4o-mini') {
  if (!text || typeof text !== 'string') return 0;

  try {
    let targetModel = model;
    if (model.startsWith('gemini') || model.startsWith('mock')) {
      targetModel = 'gpt-4o-mini';
    }
    const encoder = encodingForModel(targetModel);
    const tokens = encoder.encode(text);
    return tokens.length;
  } catch (err) {
    return estimateTokensHeuristic(text);
  }
}

module.exports = { estimateTokens };
