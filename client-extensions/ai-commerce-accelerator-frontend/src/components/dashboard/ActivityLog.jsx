import React from 'react';

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
            <i className="icon icon-trash"></i>
            Clear
          </button>
        )}
      </div>

      <div className="activity-log-content">
        {logs.length === 0 ? (
          <div className="empty-state">
            <i className="icon icon-clock"></i>
            No activity yet. Configure settings and start generation.
          </div>
        ) : (
          logs.map((log, index) => {
            const getLogIcon = (type) => {
              switch (type) {
                case 'error':
                  return 'icon icon-warning';
                case 'success':
                  return 'icon icon-check';
                case 'warning':
                  return 'icon icon-alert';
                default:
                  return 'icon icon-info';
              }
            };

            return (
              <div key={index} className={`log-entry ${log.type}`}>
                <div className="log-content">
                  <i className={getLogIcon(log.type)}></i>
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
