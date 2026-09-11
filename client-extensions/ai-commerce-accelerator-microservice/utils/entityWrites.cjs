const {
  isTerminalAuthFailure,
  summariseRequestFailure,
} = require('./requestFailure.cjs');

/**
 * Writing a collection of entities one at a time, when the batch API cannot be
 * used, without letting one of them decide the fate of the rest.
 *
 * Liferay's batch engine mishandles several of these entity types, so the
 * steps that create them post each record individually and call the result a
 * simulated batch. Every such loop in this service and in the SDK collected
 * per-entity failures and then threw once at the end, which propagated through
 * the step handler and killed the workflow. A promotion to production wrote 22
 * products, lost one price entry of 52, and skipped the 22 images and 22 PDFs
 * that were the point of the exercise (#892).
 *
 * Two different failures were sharing one response:
 *
 * - **A rejected entity** is a defect in that entity. The others are
 *   unaffected, and so is every later step, so it is recorded and stepped
 *   over. The run reports what it could not write, by name and by reason.
 * - **A rejected credential** condemns everything that follows. It is thrown
 *   at once, before the loop asks the same doomed question of every remaining
 *   item - 401s do not become valid on the fifty-first attempt, and against a
 *   production instance a wall of them is rate limiting and security alerting
 *   rather than diagnosis (#890).
 *
 * `write` may retry internally where a step knows a failure is transient; this
 * is only concerned with what to do once it has given up.
 */
async function writeEachEntity({
  concurrency = 5,
  describe = String,
  entities = [],
  write,
}) {
  const failures = [];
  let terminal = null;
  let written = 0;

  for (let start = 0; start < entities.length; start += concurrency) {
    if (terminal) break;

    await Promise.all(
      entities.slice(start, start + concurrency).map(async (entity) => {
        try {
          await write(entity);
          written += 1;
        } catch (error) {
          if (isTerminalAuthFailure(error)) {
            terminal = terminal || error;
            return;
          }

          failures.push({
            reason: summariseRequestFailure(error),
            subject: describe(entity),
          });
        }
      })
    );
  }

  if (terminal) throw terminal;

  return { failures, written };
}

/**
 * The failures as one line, naming the entities rather than leaving them to
 * the log. A run that ends with 51 of 52 prices should say which one is
 * missing (#892).
 */
function summariseFailures(failures, { limit = 5 } = {}) {
  const named = failures
    .slice(0, limit)
    .map(({ reason, subject }) => `${subject} (${reason})`)
    .join(', ');

  const remainder = failures.length - Math.min(failures.length, limit);

  return remainder > 0 ? `${named} and ${remainder} more` : named;
}

module.exports = { summariseFailures, writeEachEntity };
