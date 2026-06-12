/**
 * Zero-dependency pre-flight Token Estimator utility for prompt safety gatekeeping.
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;

  // Standard GPT/Gemini heuristic: ~4 characters per token for English text/JSON payloads
  const charBased = Math.ceil(text.length / 4.0);

  // Word-based BPE fallback estimation (usually matches BPE subwords within 10% tolerance)
  const wordCount = text.split(/\s+/).length;
  const wordBased = Math.ceil(wordCount * 1.3);

  // Take the safer, larger bound for conservative guardrailing
  return Math.max(charBased, wordBased);
}

module.exports = { estimateTokens };
