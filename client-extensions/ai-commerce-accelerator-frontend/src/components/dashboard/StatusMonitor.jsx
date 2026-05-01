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

function WsDot({ status, onReconnect }) {
  const labelMap = {
    connected: 'Live updates active. Click to refresh connection.',
    connecting: 'Live updates connecting...',
    disabled: 'Live updates disabled.',
    error: 'Live updates error. Click to retry.',
    closed: 'Live updates closed. Click to reconnect.',
  };

  const label = labelMap[status] || 'Live updates';
  return (
    <button
      className={`ws-dot-btn ws-${status}`}
      onClick={(e) => {
        e.preventDefault();
        onReconnect?.();
      }}
      title={label}
      aria-label={label}
      type="button"
      disabled={status === 'connecting'}
    >
      <span className={`ws-dot ws-${status}`} role="status" />
    </button>
  );
}

function StatusMonitor({ lastUpdated, elapsedMs, wsStatus, onReconnect }) {
  return (
    <div className="last-updated">
      <small className="info-text">
        Last updated: {formatTimestamp(lastUpdated)} · Elapsed:{' '}
        {formatDuration(elapsedMs)}
      </small>
      <WsDot status={wsStatus} onReconnect={onReconnect} />
    </div>
  );
}

export default StatusMonitor;
