import React, { useMemo } from 'react';
import ConsolePanel from '../common/ConsolePanel';

// The activity log emits a lowercase `type`, while the websocket stream emits an
// uppercase `level`. ConsolePanel speaks `level`, so normalise here rather than
// teaching the shared component two vocabularies.
const TYPE_TO_LEVEL = {
  error: 'ERROR',
  info: 'INFO',
  success: 'SUCCESS',
  warning: 'WARN',
};

export function toConsoleEntries(logs = []) {
  return logs.map((log, index) => ({
    id: log.id ?? index,
    level: TYPE_TO_LEVEL[log.type] || 'INFO',
    message: log.message,
    timestamp: log.timestamp,
  }));
}

// `newestFirst` because useActivityLog prepends - it truncates with
// `slice(0, maxEntries)` to keep the newest - so the arriving entry is at the
// top and auto-scroll has to follow the top rather than the bottom.
function ActivityLog({ logs = [], onClearLogs, isGenerating }) {
  const entries = useMemo(() => toConsoleEntries(logs), [logs]);

  return (
    <ConsolePanel
      busy={isGenerating}
      clearDisabled={isGenerating}
      emptyMessage="Waiting for activity..."
      entries={entries}
      fillHeight
      newestFirst
      onClear={onClearLogs}
      title="Live Console"
    />
  );
}

export default ActivityLog;
