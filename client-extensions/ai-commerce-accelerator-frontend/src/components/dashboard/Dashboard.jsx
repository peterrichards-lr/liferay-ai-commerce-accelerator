import React, { useState, useCallback, useEffect } from 'react';
import ClayCard from '@clayui/card';

import ActivityLog from './ActivityLog';
import StatusMonitor from './StatusMonitor';
import ProgressMonitor from './ProgressMonitor';
import SystemStatus from './SystemStatus';
import OverallProgressGauge from './OverallProgressGauge';

import { getTotalProgress } from '../../state/progressSelectors';

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
  logs,
  isGenerating,
  onClearLogs,
  generationConfig,
  wsStatus = 'disabled',
  _batchErrors,
  onReconnect,
  connected,
  aiConfig,
}) {
  const { total, completed } = getTotalProgress(progress);
  const overallPercentage = total > 0 ? (completed / total) * 100 : 0;

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
        textProvider={aiConfig?.provider || 'openai'}
        mediaProvider={aiConfig?.mediaProvider || 'inherit'}
        textModel={aiConfig?.defaultModel || 'gpt-4o'}
        onReconnect={onReconnect}
      />

      <ClayCard className="mt-3 flex-shrink-0">
        <ClayCard.Body>
          <ClayCard.Description
            displayType="title"
            className="d-flex justify-content-between align-items-center"
          >
            Generation Status
            {isGenerating && (
              <span
                className="spinner-border spinner-border-sm text-primary"
                role="status"
              ></span>
            )}
          </ClayCard.Description>

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
            <OverallProgressGauge percentage={overallPercentage} />
          </div>

          <div className="mt-3">
            <ProgressMonitor
              generationConfig={generationConfig}
              progress={progress}
              onErrorsClick={onErrorsClick}
            />
          </div>

          <StatusMonitor
            lastUpdated={lastUpdateTime}
            elapsedMs={displayElapsedMs}
          />
        </ClayCard.Body>
      </ClayCard>

      {/* Live Console */}
      <div
        className="live-console flex-grow-1 mt-3 d-flex flex-column"
        style={{ minHeight: '250px' }}
      >
        <ActivityLog
          onClearLogs={onClearLogs}
          logs={logs}
          isGenerating={isGenerating}
        />
      </div>
    </div>
  );
}

export default Dashboard;
