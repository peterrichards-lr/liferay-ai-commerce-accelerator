import React from 'react';
import ClayIcon from '@clayui/icon';
import ClayCard from '@clayui/card';
import ClayLabel from '@clayui/label';

const statusStyles = `
  @keyframes status-pulse {
    0% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.2); }
    100% { opacity: 1; transform: scale(1); }
  }
  .status-dot-pulse {
    animation: status-pulse 1s infinite ease-in-out;
  }
`;

function StatusDot({ type, isFlashing }) {
  const colorMap = {
    danger: 'var(--brand-danger, var(--danger, #da1e28))',
    secondary: 'var(--brand-secondary, var(--secondary, #6b6c7e))',
    success: 'var(--brand-success, var(--success, #28a745))',
    warning: 'var(--brand-warning, var(--warning, #ffc107))',
  };

  return (
    <div
      className={`rounded-circle ${isFlashing ? 'status-dot-pulse' : ''}`}
      style={{
        backgroundColor: colorMap[type] || 'currentColor',
        flexShrink: 0,
        height: '10px',
        width: '10px',
      }}
    />
  );
}

function StatusItem({ icon, title, status, details, onClick, isLiveMonitor }) {
  const isError = status === 'error' || status === 'closed';
  const isSuccess =
    status === 'connected' || status === 'ready' || status === 'active';
  const isWarning = status === 'connecting' || status === 'degraded';

  const displayType = isError
    ? 'danger'
    : isSuccess
      ? 'success'
      : isWarning
        ? 'warning'
        : 'secondary';

  const labelText = status.charAt(0).toUpperCase() + status.slice(1);

  const content = (
    <div className="d-flex align-items-center border-bottom py-2">
      <div
        className="d-flex align-items-center justify-content-center mr-3"
        style={{ width: '20px' }}
      >
        {isLiveMonitor ? (
          <StatusDot isFlashing={status === 'connecting'} type={displayType} />
        ) : (
          <div className="text-secondary">
            <ClayIcon symbol={icon} style={{ fontSize: '1rem' }} />
          </div>
        )}
      </div>

      <div className="overflow-hidden flex-grow-1">
        <div className="d-flex align-items-center justify-content-between">
          <span
            className="font-weight-semi-bold text-truncate"
            style={{ fontSize: '0.875rem' }}
          >
            {title}
          </span>
          {onClick && isError && (
            <div
              className="text-primary flex-shrink-0 mr-3"
              style={{ fontSize: '0.65rem', fontWeight: 'bold' }}
            >
              <ClayIcon symbol="reload" className="mr-1" />
              RECONNECT
            </div>
          )}
        </div>
        {details && (
          <span
            className="text-secondary d-block text-truncate"
            style={{ fontSize: '0.7rem' }}
          >
            {details}
          </span>
        )}
      </div>

      <div
        className="flex-shrink-0 text-right ml-3"
        style={{ minWidth: '85px' }}
      >
        <ClayLabel displayType={displayType} size="sm">
          {labelText}
        </ClayLabel>
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        className="btn btn-unstyled p-0 text-left w-100"
        onClick={onClick}
        title={`Click to reconnect ${title}`}
      >
        {content}
      </button>
    );
  }

  return content;
}

function SystemStatus({
  liferayStatus,
  wsStatus,
  textProvider,
  mediaProvider,
  textModel,
  textKeyAvailable,
  mediaKeyAvailable,
  onReconnect,
}) {
  const isMediaInherit = mediaProvider?.toUpperCase() === 'INHERIT';
  const displayMediaProvider = isMediaInherit
    ? `SAME AS CORE (${textProvider?.toUpperCase() || 'OPENAI'})`
    : mediaProvider?.toUpperCase() || 'OPENAI';

  return (
    <ClayCard className="mb-3 shadow-sm border-0">
      <style>{statusStyles}</style>
      <ClayCard.Body className="p-4">
        <h4 className="mb-4 font-weight-bold" style={{ fontSize: '1.1rem' }}>
          System Status
        </h4>

        <div
          className="status-list d-flex flex-column"
          style={{ gap: '0.5rem' }}
        >
          <StatusItem
            icon="liferay-logo"
            status={liferayStatus ? 'connected' : 'error'}
            details={liferayStatus ? 'Session established' : 'No connection'}
            title="Liferay DXP"
          />

          <StatusItem
            isLiveMonitor
            onClick={onReconnect}
            status={wsStatus === 'connected' ? 'active' : 'waiting'}
            details={
              wsStatus === 'connected'
                ? 'Real-time updates active'
                : 'Polling fallback active'
            }
            title="Live Monitor"
          />

          <StatusItem
            details={`${textProvider?.toUpperCase() || 'OPENAI'} / ${textModel || 'gpt-4o'}`}
            icon="magic"
            status={liferayStatus && textKeyAvailable ? 'active' : 'waiting'}
            title="AI Text (Core)"
          />

          <StatusItem
            details={displayMediaProvider}
            icon="picture"
            status={
              liferayStatus &&
              (isMediaInherit ? textKeyAvailable : mediaKeyAvailable)
                ? 'active'
                : 'waiting'
            }
            title="AI Media"
          />
        </div>
      </ClayCard.Body>
    </ClayCard>
  );
}

export default SystemStatus;
