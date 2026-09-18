const { PersistenceService } = require('@liferay/accelerator-sdk');

/**
 * The two writes resume needs and the SDK does not have.
 *
 * `tryFailSession`, `tryFinalizeSession` and `tryCancelSession` are one-way:
 * every one of them guards on `status NOT IN ('COMPLETED', 'FAILED')`, so a
 * FAILED session is final and nothing can point the engine at it again. And a
 * step's state is derived from its batch rows, so a step that holds a FAILED
 * row reads FAILED for as long as that row exists - `clearAll` is the only
 * thing that removes one, and it removes every session there is.
 *
 * Both are written here rather than in the SDK because this file is already
 * the seam - it has been a bare re-export - and a resume that waits on an SDK
 * release is a resume nobody has. They belong upstream eventually; until then
 * they are two statements against the schema the SDK owns, and each is
 * guarded so it can only move state in the one direction resume needs.
 */
class AicaPersistenceService extends PersistenceService {
  /**
   * Removes the FAILED batch rows of one step, returning the step to PENDING.
   *
   * Scoped to a single step on purpose. The rows of every other step are what
   * `summariseSessionProgress` reads, so clearing more than the failed step
   * would empty the part of the progress bar that records work Liferay
   * actually did.
   */
  async clearFailedBatchesForStep(sessionId, stepKey) {
    const doomed = await this._all(
      "SELECT erc FROM workflow_batches WHERE session_id = ? AND step_key = ? AND status = 'FAILED'",
      sessionId,
      stepKey
    );

    if (doomed.length === 0) return 0;

    await this._run(
      "DELETE FROM workflow_batches WHERE session_id = ? AND step_key = ? AND status = 'FAILED'",
      sessionId,
      stepKey
    );

    // Both caches, because `getBatch` keys on the ERC and
    // `getBatchesForSession` on the session, and a stale read of either would
    // put the step straight back into FAILED.
    this.cache.del(`batches-${sessionId}`);
    doomed.forEach((row) => this.cache.del(`batch-${row.erc}`));

    return doomed.length;
  }

  /**
   * Moves a FAILED session back to STARTED so the engine will advance it.
   *
   * The counterpart `tryFailSession` never had. Guarded on FAILED alone: a
   * COMPLETED session has nothing to resume and a running one is already being
   * advanced, and reviving either would race the orchestrator. The error
   * fields go with the status, or the revived session would still be reporting
   * the failure it has just been asked to retry.
   */
  async tryReviveSession(sessionId) {
    const result = await this._run(
      `
      UPDATE workflow_sessions
      SET status = 'STARTED', error_message = NULL, error_reference_code = NULL, error_stack = NULL, current_steps_json = '[]', updated_at = ?
      WHERE session_id = ? AND status = 'FAILED'
      `,
      new Date().toISOString(),
      sessionId
    );

    if (result && result.changes > 0) {
      this.cache.del(sessionId);
      return true;
    }

    return false;
  }
}

module.exports = AicaPersistenceService;
