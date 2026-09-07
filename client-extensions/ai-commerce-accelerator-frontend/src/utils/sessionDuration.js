import { isCancellable } from './sessionStatus';

/**
 * How long a session ran for.
 *
 * There is no end timestamp: `workflow_sessions` records only `created_at` and
 * `updated_at`. For a session that has finished, `updated_at` is the write that
 * set its terminal status, so it stands in for the end well enough to be worth
 * showing. A session still running is measured against now.
 *
 * That approximation is the reason this is derived rather than stored: any
 * later write to a finished session - a context update, a recovery probe -
 * would move `updated_at` and stretch the reported duration. Recording an
 * explicit completion timestamp would remove the doubt.
 */
export function sessionDurationMs(session, now = Date.now()) {
  if (!session?.created_at) return null;

  const started = new Date(session.created_at).getTime();
  if (Number.isNaN(started)) return null;

  const running = isCancellable(session.status);
  const endedAt = running ? now : new Date(session.updated_at).getTime();

  if (Number.isNaN(endedAt)) return null;

  // Clock skew, or a session written out of order, should not surface as a
  // negative duration.
  return Math.max(0, endedAt - started);
}

/**
 * A duration a person can read at a glance: "4m 12s", "1h 06m", "8s".
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';

  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
