import React from 'react';
import ClayIcon from '@clayui/icon';

function AssetToggle({ label, icon, value, onChange, disabled, options }) {
  return (
    <div className="mb-3">
      <div className="d-flex align-items-center mb-2 font-weight-semi-bold">
        <ClayIcon symbol={icon} className="mr-2" />
        <span>{label}</span>
      </div>
      <div className="btn-group w-100" role="group">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`btn btn-secondary ${value === opt.value ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            style={{ flex: 1 }}
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
    <div className="form-group mb-3">
      <label className="form-label font-weight-semi-bold">
        {label}{' '}
        <span className="text-secondary font-weight-normal">({value}%)</span>
      </label>
      <input
        type="range"
        className="form-control-range custom-range"
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

export default function VisualAssetControls({ values, onChange, disabled }) {
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
    <div className="mt-4">
      <h3 className="sheet-title mb-3" style={{ fontSize: '1rem' }}>
        Visual Assets & Media
      </h3>
      <div className="row">
        <div className="col-12 col-md-6 mb-4">
          <AssetToggle
            label="Product Images"
            icon="picture"
            value={values.imageMode}
            onChange={(v) => onChange('imageMode', v)}
            disabled={disabled}
            options={imageOptions}
          />
          {values.imageMode === 'ai' && (
            <div className="p-3 bg-light rounded mt-2 border">
              <RatioControl
                label="Generation Ratio"
                value={values.imageRatio}
                onChange={(v) => onChange('imageRatio', v)}
                disabled={disabled}
              />
              <div className="form-group mb-0">
                <label className="form-label font-weight-semi-bold">
                  Image Style
                </label>
                <select
                  className="form-control"
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

        <div className="col-12 col-md-6 mb-4">
          <AssetToggle
            label="Product PDFs"
            icon="document"
            value={values.pdfMode}
            onChange={(v) => onChange('pdfMode', v)}
            disabled={disabled}
            options={pdfOptions}
          />
          {values.pdfMode === 'ai' && (
            <div className="p-3 bg-light rounded mt-2 border">
              <RatioControl
                label="Generation Ratio"
                value={values.pdfRatio}
                onChange={(v) => onChange('pdfRatio', v)}
                disabled={disabled}
              />
              <div className="form-group mb-0">
                <label className="form-label font-weight-semi-bold">
                  Content Type
                </label>
                <select
                  className="form-control"
                  value={values.pdfContentType || 'product_info'}
                  onChange={(e) => onChange('pdfContentType', e.target.value)}
                  disabled={disabled}
                >
                  <option value="product_info">Product Information</option>
                  <option value="user_guide">User Guide</option>
                  <option value="compliance">Compliance & Regulations</option>
                  <option value="technical_specs">
                    Technical Specifications
                  </option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
