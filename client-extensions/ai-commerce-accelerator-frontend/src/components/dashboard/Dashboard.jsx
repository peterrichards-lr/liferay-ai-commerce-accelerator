import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';

import ActivityLog from './ActivityLog';
import StatusMonitor from './StatusMonitor';
import DashboardHeader from './DashboardHeader';
import ProgressMonitor from './ProgressMonitor';

const STORAGE_KEYS = {
  start: 'progress.startTime',
  last: 'progress.lastUpdateTime',
  end: 'progress.endTime',
};

function loadPersistedTimes() {
  const start = Number(localStorage.getItem(STORAGE_KEYS.start)) || null;
  const last = Number(localStorage.getItem(STORAGE_KEYS.last)) || null;
  const endStr = localStorage.getItem(STORAGE_KEYS.end);
  const end = endStr != null ? Number(endStr) : null;
  return { start, last, end };
}

function persistTimes({ startTime, lastUpdateTime, endTime }) {
  startTime != null
    ? localStorage.setItem(STORAGE_KEYS.start, String(startTime))
    : localStorage.removeItem(STORAGE_KEYS.start);
  lastUpdateTime != null
    ? localStorage.setItem(STORAGE_KEYS.last, String(lastUpdateTime))
    : localStorage.removeItem(STORAGE_KEYS.last);
  endTime != null
    ? localStorage.setItem(STORAGE_KEYS.end, String(endTime))
    : localStorage.removeItem(STORAGE_KEYS.end);
}

function clearPersistedTimes() {
  localStorage.removeItem(STORAGE_KEYS.start);
  localStorage.removeItem(STORAGE_KEYS.last);
  localStorage.removeItem(STORAGE_KEYS.end);
}

function Dashboard({
  progress,
  logs,
  isGenerating,
  onClearLogs,
  onReset,
  generationConfig,
  wsStatus = 'disabled',
}) {
  const frozenRef = useRef(false);

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
          />

          <ActivityLog
            onClearLogs={onClearLogs}
            logs={logs}
            isGenerating={isGenerating}
          />

          <StatusMonitor
            lastUpdated={lastUpdateTime}
            elapsedMs={displayElapsedMs}
            wsStatus={wsStatus}
          />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
