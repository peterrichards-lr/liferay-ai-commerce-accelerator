import React from 'react';

export default function CheckboxGroup({ title, subtitle, children }) {
  return (
    <div className="config-options">
      {title && <h6 className="config-section-title">{title}</h6>}
      {subtitle && <small className="config-subtitle">{subtitle}</small>}
      <div className="checkbox-group-grid">{children}</div>
    </div>
  );
}
