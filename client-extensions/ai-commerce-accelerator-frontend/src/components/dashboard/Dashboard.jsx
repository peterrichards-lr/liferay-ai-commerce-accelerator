import React, { useState, useCallback, useEffect } from 'react';
import ClayCard from '@clayui/card';
import ClayLabel from '@clayui/label';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';

import StatusMonitor from './StatusMonitor';
import ProgressMonitor from './ProgressMonitor';
import SystemStatus from './SystemStatus';
import OverallProgressGauge from './OverallProgressGauge';

import { getTotalProgress } from '../../state/progressSelectors';

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

function WsStatusIndicator({ status, onReconnect }) {
  const colorMap = {
    connected: 'var(--brand-success, var(--success, #28a745))',
    connecting: 'var(--brand-warning, var(--warning, #ffc107))',
    disabled: 'var(--brand-secondary, var(--secondary, #6c757d))',
    error: 'var(--brand-danger, var(--danger, #dc3545))',
    closed: 'var(--brand-danger, var(--danger, #dc3545))',
    unknown: 'var(--brand-secondary, var(--secondary, #6c757d))',
  };

  return (
    <>
      <style>{statusStyles}</style>
      <button
        className="btn btn-unstyled p-0 d-flex align-items-center"
        onClick={onReconnect}
        title={`Live Monitor: ${status}. Click to reconnect.`}
        disabled={status === 'connecting'}
      >
        <div
          className={`rounded-circle ${status === 'connecting' ? 'status-dot-pulse' : ''}`}
          style={{
            backgroundColor: colorMap[status] || 'currentColor',
            width: '10px',
            height: '10px',
            boxShadow: '0 0 4px rgba(0,0,0,0.2)',
          }}
        />
      </button>
    </>
  );
}

const STORAGE_KEYS = {
  start: 'progress.startTime',
  last: 'progress.lastUpdateTime',
  end: 'progress.endTime',
};

function loadPersistedTimes() {
  const start = Number(sessionStorage.getItem(STORAGE_KEYS.start)) || null;
  const last = Number(sessionStorage.getItem(STORAGE_KEYS.last)) || null;
  const endStr = sessionStorage.getItem(STORAGE_KEYS.end);
  const end = endStr != null ? Number(endStr) : null;
  return { start, last, end };
}

function Dashboard({
  progress,
  isGenerating,
  generationConfig,
  wsStatus = 'disabled',
  _batchErrors,
  onReconnect,
  connected,
  aiKeyAvailable,
  aiMediaKeyAvailable,
  aiConfig,
  onResetStatus,
  onResetAll,
}) {
  const { total, completed } = getTotalProgress(progress);
  const overallPercentage = total > 0 ? (completed / total) * 100 : 0;
  const isDelete = progress?.activeFlowType === 'delete';

  const [{ startTime, lastUpdateTime }] = useState(() => {
    const { start, last, end } = loadPersistedTimes();
    return { startTime: start, lastUpdateTime: last, endTime: end };
  });

  const [displayElapsedMs, setDisplayElapsedMs] = useState(() => {
    const { start, last, end } = loadPersistedTimes();
    if (!start) return 0;
    const effectiveEnd = end ?? last ?? Date.now();
    return Math.max(0, effectiveEnd - start);
  });

  const onErrorsClick = useCallback((index, entity) => {
    // In this revised design, we might want a modal or a dedicated view for batch errors
    // For now, we'll keep the state but the UI presentation might need adjustment later
    console.log('Show errors for', entity);
  }, []);

  useEffect(() => {
    if (!isGenerating || !startTime) return;
    const id = setInterval(() => {
      setDisplayElapsedMs(Math.max(0, Date.now() - startTime));
    }, 1000);
    return () => clearInterval(id);
  }, [isGenerating, startTime]);

  return (
    <div className="dashboard-sidebar d-flex flex-column h-100">
      <SystemStatus
        liferayStatus={connected}
        wsStatus={wsStatus}
        textProvider={aiConfig?.provider || 'OPENAI'}
        mediaProvider={aiConfig?.mediaProvider || 'INHERIT'}
        textModel={aiConfig?.defaultModel || 'gpt-4o'}
        textKeyAvailable={aiKeyAvailable}
        mediaKeyAvailable={aiMediaKeyAvailable}
        onReconnect={onReconnect}
      />

      <ClayCard className="mt-3 flex-shrink-0">
        <ClayCard.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h4 className="sheet-title mb-0 d-flex align-items-center">
              Workflow Status
              {isGenerating && (
                <span
                  className="spinner-border spinner-border-sm text-primary ml-2"
                  role="status"
                ></span>
              )}
              {progress?.workflowStatus === 'completed' && (
                <ClayLabel displayType="success" className="ml-2">
                  COMPLETED
                </ClayLabel>
              )}
              {progress?.workflowStatus === 'failed' && (
                <ClayLabel displayType="danger" className="ml-2">
                  FAILED
                </ClayLabel>
              )}
            </h4>
            <div className="d-flex align-items-center">
              {total > 0 && !isGenerating && (
                <div className="mr-3 d-flex align-items-center">
                  <ClayButton
                    displayType="unstyled"
                    className="text-secondary p-1 mr-2 d-flex align-items-center"
                    onClick={onResetStatus}
                    title="Clear Workflow Status"
                  >
                    <ClayIcon symbol="times-circle" />
                  </ClayButton>
                  <ClayButton
                    displayType="unstyled"
                    className="text-secondary p-1 d-flex align-items-center"
                    onClick={onResetAll}
                    title="Clear Status & Logs"
                  >
                    <ClayIcon symbol="trash" />
                  </ClayButton>
                </div>
              )}
              <WsStatusIndicator status={wsStatus} onReconnect={onReconnect} />
            </div>
          </div>

          <div className="mt-3">
            <div className="d-flex justify-content-between mb-1">
              <span
                className="text-secondary font-weight-semi-bold"
                style={{ fontSize: '0.875rem' }}
              >
                Overall Progress
              </span>
              <span
                className="font-weight-semi-bold"
                style={{ fontSize: '0.875rem' }}
              >
                {Math.round(overallPercentage)}%
              </span>
            </div>
            <OverallProgressGauge
              percentage={overallPercentage}
              isDelete={isDelete}
            />
          </div>

          <div className="mt-3">
            <ProgressMonitor
              generationConfig={generationConfig}
              progress={progress}
              onErrorsClick={onErrorsClick}
              isDelete={isDelete}
            />
          </div>

          <StatusMonitor
            lastUpdated={lastUpdateTime}
            elapsedMs={displayElapsedMs}
          />
        </ClayCard.Body>
      </ClayCard>
    </div>
  );
}

export default Dashboard;
