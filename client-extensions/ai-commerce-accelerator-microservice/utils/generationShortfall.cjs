/**
 * Completing a generation step against what was *asked for*, not what arrived.
 *
 * A step that reports `delivered` as both the processed count and the total
 * records "38 of 38" for a run that asked for 50, so the shortfall is not
 * merely unreported - it is arithmetically unrepresentable. The denominator has
 * to come from the request, or the step is asserting a completeness it never
 * established (#955).
 *
 * Products already did this and the other generators did not, so the logic
 * lives here rather than in four places that can drift apart.
 *
 * Only for steps with a requested count. Promotions ask the model for `0` and
 * let it decide how many to return, so there is no shortfall to measure there
 * and calling this with a falsy `requested` records the plain completion.
 */
async function completeGenerationStep(
  generator,
  { sessionId, step, delivered, requested, noun }
) {
  const shortfall = (requested || 0) - delivered;

  if (shortfall > 0) {
    const reason =
      `The AI returned ${delivered} of ${requested} requested ${noun}; ` +
      `the rest of the run covers only what it delivered`;

    generator.logger.error(`${noun} generation fell short: ${reason}`, {
      sessionId,
      delivered,
      requested,
    });

    return generator.completeSyncStep(
      sessionId,
      step,
      'SYNCHRONOUS',
      delivered,
      requested,
      reason
    );
  }

  return generator.completeSyncStep(
    sessionId,
    step,
    'SYNCHRONOUS',
    delivered,
    requested || delivered
  );
}

module.exports = { completeGenerationStep };
