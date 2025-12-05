import React from 'react';
import ClayIcon from '@clayui/icon';

function ActivityLog({ logs, onClearLogs, isGenerating }) {
  return (
    <div className="activity-log">
      <div className="activity-log-header">
        <h6>Activity Log</h6>
        {logs.length > 0 && (
          <button
            className="clear-logs-button"
            onClick={onClearLogs}
            disabled={isGenerating}
            title="Clear activity log"
          >
            <ClayIcon symbol="trash" className="me-2" />
            Clear
          </button>
        )}
      </div>

      <div className="activity-log-content">
        {logs.length === 0 ? (
          <div className="empty-state">
            <ClayIcon symbol="time" className="me-2" />
            No activity yet. Configure settings and start generation.
          </div>
        ) : (
          logs.map((log, index) => {
            const getLogIconSymbol = (type) => {
              switch (type) {
                case 'error':
                  return 'warning-full';
                case 'success':
                  return 'check';
                case 'warning':
                  return 'warning-full';
                default:
                  return 'info-circle';
              }
            };

            return (
              <div key={index} className={`log-entry ${log.type}`}>
                <div className="log-content">
                  <ClayIcon symbol={getLogIconSymbol(log.type)} />
                  <div className="log-details">
                    <small className="log-timestamp">{log.timestamp}</small>
                    <span className="log-message">{log.message}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {isGenerating && (
          <div className="processing-indicator">
            <div className="spinner"></div>
            <span>Processing...</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityLog;
