/**
 * Whether a workflow session can still be cancelled.
 *
 * Mirrors the microservice's `tryCancelSession`, which updates any session
 * whose status is not already terminal:
 *
 *   WHERE session_id = ? AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
 *
 * The list is expressed as exclusions rather than as the set of running states
 * so that a status this build has not seen - a new step state, or one added
 * later - is treated as cancellable. Offering to cancel something already
 * finished is harmless; refusing to cancel something stuck is not.
 */
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function isCancellable(status) {
  return !TERMINAL_STATUSES.includes(String(status || '').toUpperCase());
}

export { TERMINAL_STATUSES };
