import React from 'react';
import ClayIcon from '@clayui/icon';

function StatusBadge({ icon, label, status, sublabel }) {
  const statusClass =
    {
      connected: 'label-success',
      healthy: 'label-success',
      active: 'label-success',
      connecting: 'label-warning',
      degraded: 'label-warning',
      warning: 'label-warning',
      error: 'label-danger',
      unhealthy: 'label-danger',
      closed: 'label-secondary',
      disabled: 'label-secondary',
    }[status] || 'label-secondary';

  return (
    <div className="status-badge-item">
      <div className={`status-badge-icon ${statusClass}`}>
        <ClayIcon symbol={icon} className="lexicon-icon" />
      </div>
      <div className="status-badge-content">
        <div className="status-badge-label">{label}</div>
        <div className="status-badge-status text-truncate">
          {sublabel ? `${sublabel} (${status})` : status}
        </div>
      </div>
    </div>
  );
}

function SystemStatus({
  liferayStatus,
  wsStatus,
  textProvider,
  mediaProvider,
  textModel,
  onReconnect,
}) {
  return (
    <div className="system-status-strip mb-4">
      <div className="status-section">
        <StatusBadge
          icon="globe"
          label="Liferay DXP"
          status={liferayStatus ? 'connected' : 'error'}
        />
      </div>

      <div className="status-divider" />

      <div className="status-section">
        <button
          className="status-btn"
          onClick={onReconnect}
          title="Click to reconnect WebSocket"
        >
          <StatusBadge icon="api" label="Live Monitor" status={wsStatus} />
        </button>
      </div>

      <div className="status-divider" />

      <div className="status-section">
        <StatusBadge
          icon="magic"
          label="AI Text"
          status="active"
          sublabel={`${textProvider?.toUpperCase() || 'OPENAI'} / ${textModel || 'gpt-4o'}`}
        />
      </div>

      <div className="status-divider" />

      <div className="status-section">
        <StatusBadge
          icon="picture"
          label="AI Media"
          status="active"
          sublabel={
            mediaProvider === 'inherit'
              ? textProvider?.toUpperCase() || 'OPENAI'
              : mediaProvider?.toUpperCase() || 'OPENAI'
          }
        />
      </div>
    </div>
  );
}

export default SystemStatus;
