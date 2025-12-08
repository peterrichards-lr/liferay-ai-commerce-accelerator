import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import ClayIcon from '@clayui/icon';
import ClayTabs from '@clayui/tabs';

import ActivityLog from './ActivityLog';
import StatusMonitor from './StatusMonitor';
import DashboardHeader from './DashboardHeader';
import ProgressMonitor from './ProgressMonitor';
import BatchErrors from './BatchErrors';

import { buildFilename, exportJsonFile } from '../../utils/fileHelper';

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

function persistTimes({ startTime, lastUpdateTime, endTime }) {
  startTime != null
    ? sessionStorage.setItem(STORAGE_KEYS.start, String(startTime))
    : sessionStorage.removeItem(STORAGE_KEYS.start);
  lastUpdateTime != null
    ? sessionStorage.setItem(STORAGE_KEYS.last, String(lastUpdateTime))
    : sessionStorage.removeItem(STORAGE_KEYS.last);
  endTime != null
    ? sessionStorage.setItem(STORAGE_KEYS.end, String(endTime))
    : sessionStorage.removeItem(STORAGE_KEYS.end);
}

function clearPersistedTimes() {
  sessionStorage.removeItem(STORAGE_KEYS.start);
  sessionStorage.removeItem(STORAGE_KEYS.last);
  sessionStorage.removeItem(STORAGE_KEYS.end);
}

function Dashboard({
  progress,
  logs,
  isGenerating,
  onClearLogs,
  onReset,
  generationConfig,
  wsStatus = 'disabled',
  batchErrors,
}) {
  const frozenRef = useRef(false);

  const [screenReaderStatus, setScreenReaderStatus] = useState('');
  const hasProgress =
    !!progress &&
    typeof progress === 'object' &&
    Object.values(progress).some(
      (s) =>
        (Number(s?.completed) || 0) > 0 ||
        (Array.isArray(s?.errors) && s.errors.length > 0)
    );
  const hasLogs = Array.isArray(logs) && logs.length > 0;
  const summaryDisabled = isGenerating || !hasProgress;
  const logDisabled = isGenerating || !hasLogs;
  const allDisabled = isGenerating || !hasProgress || !hasLogs;

  const [{ startTime, lastUpdateTime, endTime }, setTimes] = useState(() => {
    const { start, last, end } = loadPersistedTimes();
    return { startTime: start, lastUpdateTime: last, endTime: end };
  });

  const [displayElapsedMs, setDisplayElapsedMs] = useState(() => {
    const { start, last, end } = loadPersistedTimes();
    if (!start) return 0;
    const effectiveEnd = end ?? last ?? Date.now();
    return Math.max(0, effectiveEnd - start);
  });
  const [activeTab, setActiveTab] = useState(0);

  const onErrorsClick = useCallback(() => {
    setActiveTab(1); // Index of the Batch Errors tab
  }, []);

  const handleExportSummary = () => {
    const filename = buildFilename('progress-summary');
    try {
      exportJsonFile(
        {
          timestamp: new Date().toISOString(),
          summary: progress,
          batchErrors,
          webSocketStatus: wsStatus,
          lastRun: {
            lastUpdateTime,
            displayElapsedMs,
          },
        },
        filename
      );
      setScreenReaderStatus(`Download started: ${filename}`);
    } catch (e) {
      setScreenReaderStatus(`Export failed: ${e?.message || 'Unknown error'}`);
    }
  };

  const handleExportLog = () => {
    const filename = buildFilename('activity-log');
    try {
      exportJsonFile(
        {
          timestamp: new Date().toISOString(),
          activityLog: logs,
          webSocketStatus: wsStatus,
          lastRun: {
            lastUpdateTime,
            displayElapsedMs,
          },
        },
        filename
      );
      setScreenReaderStatus(`Download started: ${filename}`);
    } catch (e) {
      setScreenReaderStatus(`Export failed: ${e?.message || 'Unknown error'}`);
    }
  };

  const handleExportAll = () => {
    const filename = buildFilename('monitor-and-log');
    try {
      exportJsonFile(
        {
          timestamp: new Date().toISOString(),
          summary: progress,
          batchErrors,
          activityLog: logs,
          webSocketStatus: wsStatus,
          lastRun: {
            lastUpdateTime,
            displayElapsedMs,
          },
        },
        filename
      );
      setScreenReaderStatus(`Download started: ${filename}`);
    } catch (e) {
      setScreenReaderStatus(`Export failed: ${e?.message || 'Unknown error'}`);
    }
  };

  const startRun = useCallback(() => {
    frozenRef.current = false;
    const now = Date.now();
    const next = { startTime: now, lastUpdateTime: now, endTime: null };
    setTimes(next);
    persistTimes(next);
    setDisplayElapsedMs(0);
  }, []);

  const tick = useCallback(() => {
    if (!startTime || frozenRef.current) return;
    const frozenEnd = Date.now();
    const next = { startTime, lastUpdateTime: frozenEnd, endTime: frozenEnd };
    setTimes(next);
    persistTimes(next);
  }, [startTime]);

  const stopRun = useCallback(() => {
    if (!startTime) return;
    frozenRef.current = true;
    const frozenEnd = Date.now();
    const next = { startTime, lastUpdateTime, endTime: frozenEnd };
    setTimes(next);
    persistTimes(next);
    setDisplayElapsedMs(Math.max(0, frozenEnd - startTime));
  }, [startTime, lastUpdateTime]);

  const resetTimes = useCallback(() => {
    frozenRef.current = false;
    setTimes({ startTime: null, lastUpdateTime: null, endTime: null });
    clearPersistedTimes();
    setDisplayElapsedMs(0); // NEW: clear display only on Reset
  }, []);

  const handleReset = useCallback(() => {
    resetTimes(); // clear timing
    onClearLogs?.(); // clear activity log
    onReset?.(); // notify parent if provided
  }, [resetTimes, onClearLogs, onReset]);

  const prevIsGen = useRef(isGenerating);
  useEffect(() => {
    const started = isGenerating && !prevIsGen.current;
    const stopped = !isGenerating && prevIsGen.current;
    if (started) startRun();
    if (stopped) stopRun();
    prevIsGen.current = isGenerating;
  }, [isGenerating, startRun, stopRun]);

  const activityKey = useMemo(() => {
    const p = progress || {};
    return (
      (p.products?.completed || 0) +
      (p.accounts?.completed || 0) +
      (p.orders?.completed || 0) +
      (p.images?.completed || 0) +
      (p.pdfs?.completed || 0) +
      (p.products?.errors?.length || 0) +
      (p.accounts?.errors?.length || 0) +
      (p.orders?.errors?.length || 0) +
      (p.images?.errors?.length || 0) +
      (p.pdfs?.errors?.length || 0)
    );
  }, [progress]);

  const prevActivity = useRef(activityKey);
  useEffect(() => {
    if (!isGenerating) {
      prevActivity.current = activityKey;
      return;
    }
    if (activityKey !== prevActivity.current) {
      tick();
      prevActivity.current = activityKey;
    }
  }, [activityKey, isGenerating, tick]);

  useEffect(() => {
    if (!isGenerating || !startTime) return;
    const id = setInterval(() => {
      setDisplayElapsedMs(Math.max(0, Date.now() - startTime));
    }, 1000);
    return () => clearInterval(id);
  }, [isGenerating, startTime]);

  return (
    <div className="dashboard">
      <div className="dashboard-card">
        <DashboardHeader
          handleReset={handleReset}
          isGenerating={isGenerating}
        />

        <div className="dashboard-body">
          <ProgressMonitor
            generationConfig={generationConfig}
            progress={progress}
            onErrorsClick={onErrorsClick}
          />

          <ClayTabs active={activeTab} onActiveChange={setActiveTab}>
            <ClayTabs.Item
              key="activity-log"
              aria-controls="activity-log-panel"
            >
              Activity Log
            </ClayTabs.Item>
            {batchErrors && batchErrors.length > 0 && (
              <ClayTabs.Item
                key="batch-errors"
                aria-controls="batch-errors-panel"
              >
                Batch Errors
              </ClayTabs.Item>
            )}
          </ClayTabs>
          <ClayTabs.Content activeIndex={activeTab}>
            <ClayTabs.TabPane aria-labelledby="activity-log-tab">
              <ActivityLog
                onClearLogs={onClearLogs}
                logs={logs}
                isGenerating={isGenerating}
              />
            </ClayTabs.TabPane>
            {batchErrors && batchErrors.length > 0 && (
              <ClayTabs.TabPane aria-labelledby="batch-errors-tab">
                <BatchErrors batchErrors={batchErrors} />
              </ClayTabs.TabPane>
            )}
          </ClayTabs.Content>

          <StatusMonitor
            lastUpdated={lastUpdateTime}
            elapsedMs={displayElapsedMs}
            wsStatus={wsStatus}
          />

          <div className="export-controls">
            <div
              className="export-controls__group"
              role="group"
              aria-label="Export options"
              aria-busy={isGenerating ? 'true' : undefined}
            >
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm export-button"
                onClick={handleExportSummary}
                aria-label="Export progress summary as JSON"
                aria-controls="progress-summary"
                disabled={summaryDisabled}
                aria-disabled={summaryDisabled ? 'true' : undefined}
                title={
                  summaryDisabled
                    ? 'Nothing to export yet'
                    : 'Download the current progress summary (JSON)'
                }
              >
                <span className="icon-left">
                  <ClayIcon symbol="download" />
                </span>
                Export Summary
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm export-button"
                onClick={handleExportLog}
                aria-label="Export activity log as JSON"
                aria-controls="activity-log"
                disabled={logDisabled}
                aria-disabled={logDisabled ? 'true' : undefined}
                title={
                  logDisabled
                    ? 'No activity entries yet'
                    : 'Download the activity log entries (JSON)'
                }
              >
                <span className="icon-left">
                  <ClayIcon symbol="download" />
                </span>
                Export Log
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm export-button"
                onClick={handleExportAll}
                aria-label="Export progress summary and activity log as a single JSON file"
                aria-controls="progress-summary activity-log"
                disabled={allDisabled}
                aria-disabled={allDisabled ? 'true' : undefined}
                title={
                  allDisabled
                    ? 'Nothing to export yet'
                    : 'Download both summary and activity log (JSON)'
                }
              >
                <span className="icon-left">
                  <ClayIcon symbol="download" />
                </span>
                Export All
              </button>
            </div>
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              {screenReaderStatus}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
