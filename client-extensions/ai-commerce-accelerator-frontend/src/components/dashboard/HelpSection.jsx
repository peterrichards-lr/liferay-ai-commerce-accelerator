import React from 'react';
import ClayIcon from '@clayui/icon';

function HelpSection() {
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
            className="btn btn-outline-secondary btn-sm w-100 d-flex align-items-center justify-content-center"
          >
            <ClayIcon symbol="book" className="me-2" />
            Liferay Commerce Docs
          </a>
        </div>
      </div>
    </div>
  );
}

export default HelpSection;
