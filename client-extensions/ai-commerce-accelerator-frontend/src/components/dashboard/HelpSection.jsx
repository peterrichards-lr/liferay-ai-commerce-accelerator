import React from 'react';
import ClayIcon from '@clayui/icon';
import ClayButton from '@clayui/button';

function HelpSection() {
  const handleFactoryReset = () => {
    if (
      window.confirm(
        'Are you sure you want to perform a factory reset? This will delete all saved configurations, keys, and workflow history from your browser.'
      )
    ) {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('aica_')) {
          localStorage.removeItem(key);
        }
      });
      window.location.reload();
    }
  };

  return (
    <div className="help-section mb-4">
      <div className="card shadow-sm border-0 bg-light">
        <div className="card-body p-3">
          <h6 className="d-flex align-items-center mb-2 font-weight-bold">
            <ClayIcon symbol="info-circle" className="mr-2 text-info" />
            Quick Start Guide
          </h6>
          <p className="small text-muted mb-3">
            Accelerate your Liferay Commerce setup with AI-driven data. Need
            help understanding commerce concepts?
          </p>
          <a
            href="https://learn.liferay.com/w/dxp/commerce"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline-secondary btn-sm w-100 d-flex align-items-center justify-content-center mb-2"
          >
            <ClayIcon symbol="book" className="me-2" />
            Liferay Commerce Docs
          </a>
          <ClayButton
            displayType="danger"
            size="sm"
            className="w-100 d-flex align-items-center justify-content-center"
            onClick={handleFactoryReset}
            title="Wipe all local configurations and restart"
          >
            <ClayIcon symbol="warning-full" className="mr-2" />
            Factory Reset App
          </ClayButton>
        </div>
      </div>
    </div>
  );
}

export default HelpSection;
