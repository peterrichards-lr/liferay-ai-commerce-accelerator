import React from 'react';
import ClayIcon from '@clayui/icon';

function DashboardEmptyState({ connected, hasConfig }) {
  return (
    <div className="dashboard-empty-state">
      <div className="empty-state-content">
        <div className="empty-state-icon">
          <ClayIcon symbol="analytics" />
        </div>
        <h4>Ready to Accelerate?</h4>
        <p className="text-muted">
          Your dashboard will come alive once you start a generation or deletion
          flow.
        </p>

        {!connected && (
          <div className="setup-tip alert alert-warning">
            <ClayIcon symbol="info-circle" />
            <span>
              <strong>Tip:</strong> Ensure your Liferay connection is tested and
              active in the configuration panel on the left.
            </span>
          </div>
        )}

        {connected && (
          <div className="setup-tip alert alert-info">
            <ClayIcon symbol="magic" />
            <span>
              <strong>Next Step:</strong> Use the{' '}
              <strong>Data Generation</strong> form to create products,
              accounts, and orders for your catalog.
            </span>
          </div>
        )}

        <div className="quick-guide">
          <h6>Quick Guide</h6>
          <ul>
            <li>
              <ClayIcon symbol="check-circle" />
              <strong>Generate:</strong> Create realistic mock data using AI or
              Mock generators.
            </li>
            <li>
              <ClayIcon symbol="trash" />
              <strong>Cleanup:</strong> Safely remove only the data created by
              this accelerator.
            </li>
            <li>
              <ClayIcon symbol="sync" />
              <strong>Monitor:</strong> Watch the progress bars for real-time
              feedback.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default DashboardEmptyState;
