import React from 'react';

function DashboardHeader({ handleReset, isGenerating }) {
  return (
    <div className="dashboard-header">
      <h5>
        <i className="icon icon-chart"></i>
        Progress Monitor
      </h5>
      <div className="header-actions">
        {isGenerating && (
          <div className="connection-status">
            <i className="icon icon-restore"></i>
            <small className="text-success">Active</small>
          </div>
        )}
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm reset-button"
          onClick={handleReset}
          disabled={isGenerating}
          title="Reset progress counters and clear the activity log"
          aria-label="Reset progress and clear log"
        >
          <span className="icon icon-restore"></span>
          Reset
        </button>
      </div>
    </div>
  );
}

export default DashboardHeader;
