import React from 'react';
import ClayIcon from '@clayui/icon';
import ClayCard from '@clayui/card';
import ClayLabel from '@clayui/label';

function StatusItem({ icon, title, status, details, onClick }) {
  const isError = status === 'error' || status === 'closed' || status === 'disabled';
  const isWarning = status === 'connecting' || status === 'degraded';
  const displayType = isError ? 'danger' : isWarning ? 'warning' : 'success';
  const labelText = status.charAt(0).toUpperCase() + status.slice(1);

  const content = (
    <div className="d-flex justify-content-between align-items-center py-2 border-bottom">
      <div className="d-flex align-items-center">
        <div className={`mr-3 text-${displayType}`}>
          <ClayIcon symbol={icon} style={{ fontSize: '1.25rem' }} />
        </div>
        <div>
          <span className="font-weight-semi-bold d-block" style={{ fontSize: '0.875rem' }}>{title}</span>
          {details && <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{details}</span>}
        </div>
      </div>
      <div>
        <ClayLabel displayType={displayType} size="sm">{labelText}</ClayLabel>
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button className="btn btn-unstyled w-100 text-left p-0" onClick={onClick} title="Click to reconnect">
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
  onReconnect,
}) {
  return (
    <ClayCard className="mb-3">
      <ClayCard.Body>
        <ClayCard.Description displayType="title" className="mb-3">
          System Connectivity
        </ClayCard.Description>
        
        <div className="status-list">
          <StatusItem
            icon="globe"
            title="Liferay DXP"
            status={liferayStatus ? 'connected' : 'error'}
          />
          
          <StatusItem 
            icon="api" 
            title="Live Monitor" 
            status={wsStatus} 
            onClick={onReconnect}
          />
          
          <StatusItem
            icon="magic"
            title="AI Text"
            status={liferayStatus ? 'active' : 'disabled'}
            details={`${textProvider?.toUpperCase() || 'OPENAI'} / ${textModel || 'gpt-4o'}`}
          />
          
          <StatusItem
            icon="picture"
            title="AI Media"
            status={liferayStatus ? 'active' : 'disabled'}
            details={
              mediaProvider === 'inherit'
                ? textProvider?.toUpperCase() || 'OPENAI'
                : mediaProvider?.toUpperCase() || 'OPENAI'
            }
          />
        </div>
      </ClayCard.Body>
    </ClayCard>
  );
}

export default SystemStatus;