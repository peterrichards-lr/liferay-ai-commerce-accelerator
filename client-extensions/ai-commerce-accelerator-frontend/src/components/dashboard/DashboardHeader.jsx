import React from 'react';
import ClayIcon from '@clayui/icon';

function DashboardHeader({ handleReset, isGenerating }) {
  return (
    <div className="dashboard-header">
      <h5>
        <ClayIcon symbol="analytics" />
        Progress Monitor
      </h5>
      <div className="header-actions">
        {isGenerating && (
          <div className="connection-status">
            <ClayIcon symbol="redo" />
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
          <ClayIcon symbol="redo" />
          Reset
        </button>
      </div>
    </div>
  );
}

export default DashboardHeader;
