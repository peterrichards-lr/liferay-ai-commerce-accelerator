const { PersistenceService } = require('@liferay/accelerator-sdk');

/**
 * The SDK's persistence service, re-exported.
 *
 * This file carried two methods resume needs and the SDK did not have:
 * `tryReviveSession`, the counterpart `tryFailSession` never had, and
 * `clearFailedBatchesForStep`, because `clearAll` was the only delete and it
 * removed every session there is.
 *
 * They belonged upstream by ownership rather than by preference — `executeNextStep`
 * derives a step's state from those very rows, and that file is the SDK's — and
 * there was no supported seam to use instead: the only public deletes are
 * `clearAll()` and `cleanup(cutoff)`, and `updateSessionStatus` would revive a
 * COMPLETED or running session, leave the three error fields, leave
 * `current_steps_json`, and report the session rather than whether the
 * transition happened.
 *
 * Both shipped in SDK v0.12.0 (#1041), so what was written here against a schema
 * the SDK owns is now the SDK's own code. The file stays as the seam it has
 * always been, rather than being deleted and its importers repointed.
 */
module.exports = PersistenceService;
