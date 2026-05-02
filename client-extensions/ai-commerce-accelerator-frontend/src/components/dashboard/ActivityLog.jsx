import React, { useEffect, useRef } from 'react';
import ClayIcon from '@clayui/icon';
import ClayButton from '@clayui/button';

function ActivityLog({ logs, onClearLogs, isGenerating }) {
  const logContainerRef = useRef(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      className="activity-log-console d-flex flex-column h-100"
      style={{
        border: '1px solid #E2E5E7',
        borderRadius: '0.25rem',
        overflow: 'hidden',
      }}
    >
      <div className="console-header d-flex justify-content-between align-items-center p-2 bg-light border-bottom">
        <span
          className="font-weight-semi-bold text-uppercase text-secondary"
          style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}
        >
          <ClayIcon symbol="terminal" className="mr-1" /> Live Console
        </span>
        {logs.length > 0 && (
          <ClayButton
            displayType="unstyled"
            size="sm"
            className="text-secondary p-0"
            onClick={onClearLogs}
            disabled={isGenerating}
            title="Clear console"
          >
            Clear
          </ClayButton>
        )}
      </div>

      <div
        className="console-body p-3 flex-grow-1"
        ref={logContainerRef}
        style={{
          backgroundColor: '#272833',
          color: '#F8F9FA',
          fontFamily: 'monospace',
          fontSize: '0.875rem',
          overflowY: 'auto',
          maxHeight: '400px',
        }}
      >
        {logs.length === 0 ? (
          <div className="text-muted font-italic">Waiting for activity...</div>
        ) : (
          logs.map((log, index) => {
            let colorClass = 'text-light';
            let prefix = '[INFO]';

            switch (log.type) {
              case 'error':
                colorClass = 'text-danger';
                prefix = '[ERROR]';
                break;
              case 'success':
                colorClass = 'text-success';
                prefix = '[OK]';
                break;
              case 'warning':
                colorClass = 'text-warning';
                prefix = '[WARN]';
                break;
            }

            return (
              <div
                key={index}
                className="log-line mb-1"
                style={{ wordBreak: 'break-word' }}
              >
                <span className="text-muted mr-2" style={{ color: '#869CAF' }}>
                  [{log.timestamp}]
                </span>
                <span className={`${colorClass} mr-2 font-weight-bold`}>
                  {prefix}
                </span>
                <span>{log.message}</span>
              </div>
            );
          })
        )}
        {isGenerating && (
          <div className="mt-2 text-info">
            <span
              className="spinner-border spinner-border-sm mr-2"
              role="status"
              style={{ width: '1rem', height: '1rem', borderWidth: '0.15em' }}
            ></span>
            Processing...
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityLog;
