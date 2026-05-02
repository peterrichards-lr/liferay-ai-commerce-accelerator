import React from 'react';

function formatTimestamp(ts) {
  if (!ts) return 'Never';
  try {
    const d = new Date(Number(ts));
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function StatusMonitor({ lastUpdated, elapsedMs }) {
  return (
    <div className="mt-3 pt-3 border-top text-center">
      <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
        <strong>Last updated:</strong> {formatTimestamp(lastUpdated)}{' '}
        <span className="mx-2">|</span> <strong>Elapsed:</strong>{' '}
        {formatDuration(elapsedMs)}
      </span>
    </div>
  );
}

export default StatusMonitor;
