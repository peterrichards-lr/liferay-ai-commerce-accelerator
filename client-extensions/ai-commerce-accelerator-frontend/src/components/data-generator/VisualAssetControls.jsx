import React from 'react';
import ClayIcon from '@clayui/icon';

function AssetToggle({ label, icon, value, onChange, disabled, options }) {
  return (
    <div className="asset-toggle-card">
      <div className="asset-toggle-header">
        <ClayIcon symbol={icon} />
        <span>{label}</span>
      </div>
      <div className="asset-toggle-options">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`asset-opt-btn ${value === opt.value ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RatioControl({ label, value, onChange, disabled }) {
  return (
    <div className="form-group mb-0">
      <label className="text-uppercase small font-weight-bold text-muted mb-1">
        {label} ({value}%)
      </label>
      <input
        type="range"
        className="form-control-range"
        min="0"
        max="100"
        step="10"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        disabled={disabled}
      />
    </div>
  );
}

export default function VisualAssetControls({
  values,
  onChange,
  disabled,
  aiKeyAvailable,
}) {
  const imageOptions = [
    { label: 'None', value: 'none' },
    { label: 'Placeholder', value: 'placeholder' },
    { label: 'AI Gen', value: 'ai' },
  ];

  const pdfOptions = [
    { label: 'None', value: 'none' },
    { label: 'Placeholder', value: 'placeholder' },
    { label: 'AI Gen', value: 'ai' },
  ];

  return (
    <div className="visual-asset-controls mt-4">
      <h6 className="config-section-title">Visual Assets & Media</h6>
      <div className="asset-grid">
        <div className="asset-column">
          <AssetToggle
            label="Product Images"
            icon="picture"
            value={values.imageMode}
            onChange={(v) => onChange('imageMode', v)}
            disabled={disabled}
            options={imageOptions}
          />
          {values.imageMode === 'ai' && (
            <div className="asset-settings-panel mt-2">
              <RatioControl
                label="Image Ratio"
                value={values.imageRatio}
                onChange={(v) => onChange('imageRatio', v)}
                disabled={disabled}
              />
              <div className="form-group mt-2 mb-0">
                <label className="text-uppercase small font-weight-bold text-muted mb-1">
                  Style
                </label>
                <select
                  className="form-control form-control-sm"
                  value={values.imageStyle}
                  onChange={(e) => onChange('imageStyle', e.target.value)}
                  disabled={disabled}
                >
                  <option value="photographic">Photographic</option>
                  <option value="minimalist">Minimalist</option>
                  <option value="abstract">Abstract</option>
                  <option value="sketch">Sketch</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="asset-column">
          <AssetToggle
            label="Product PDFs"
            icon="document"
            value={values.pdfMode}
            onChange={(v) => onChange('pdfMode', v)}
            disabled={disabled}
            options={pdfOptions}
          />
          {values.pdfMode === 'ai' && (
            <div className="asset-settings-panel mt-2">
              <RatioControl
                label="PDF Ratio"
                value={values.pdfRatio}
                onChange={(v) => onChange('pdfRatio', v)}
                disabled={disabled}
              />
              <div className="form-group mt-2 mb-0">
                <label className="text-uppercase small font-weight-bold text-muted mb-1">
                  Content Type
                </label>
                <select
                  className="form-control form-control-sm"
                  value={values.pdfContentType || 'product_info'}
                  onChange={(e) => onChange('pdfContentType', e.target.value)}
                  disabled={disabled}
                >
                  <option value="product_info">Product Information</option>
                  <option value="user_guide">User Guide</option>
                  <option value="compliance">Compliance & Regulations</option>
                  <option value="technical_specs">Technical Specifications</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
