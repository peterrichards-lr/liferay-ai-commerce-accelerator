import React from 'react';
import ClayIcon from '@clayui/icon';
import { ClaySelect } from '@clayui/form';

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
            className={`btn ${value === opt.value ? 'btn-primary active' : 'btn-secondary'}`}
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

function RatioControl({ id, label, value, onChange, disabled }) {
  return (
    <div className="form-group mb-3">
      <label htmlFor={id} className="form-label font-weight-semi-bold">
        {label}{' '}
        <span className="text-secondary font-weight-normal">({value}%)</span>
      </label>
      <input
        id={id}
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
      <h3 className="sheet-title mb-4" style={{ fontSize: '1rem' }}>
        Visual Assets & Media
      </h3>
      <div className="d-flex flex-column" style={{ gap: '1.5rem' }}>
        <div className="asset-section">
          <AssetToggle
            label="Product Images"
            icon="picture"
            value={values.imageMode}
            onChange={(v) => onChange('imageMode', v)}
            disabled={disabled}
            options={imageOptions}
          />
          {values.imageMode === 'ai' && (
            <div className="p-3 bg-light rounded border mt-2">
              <RatioControl
                id="imageRatio"
                label="Generation Ratio"
                value={values.imageRatio}
                onChange={(v) => onChange('imageRatio', v)}
                disabled={disabled}
              />
              <div className="form-group mb-0">
                <label
                  htmlFor="imageStyle"
                  className="form-label font-weight-semi-bold"
                >
                  Image Style
                </label>
                <ClaySelect
                  id="imageStyle"
                  aria-label="Image Style"
                  value={values.imageStyle}
                  onChange={(e) => onChange('imageStyle', e.target.value)}
                  disabled={disabled}
                >
                  <ClaySelect.Option
                    value="photographic"
                    label="Photographic"
                  />
                  <ClaySelect.Option value="minimalist" label="Minimalist" />
                  <ClaySelect.Option value="abstract" label="Abstract" />
                  <ClaySelect.Option value="sketch" label="Sketch" />
                </ClaySelect>
              </div>
            </div>
          )}
        </div>

        <div className="asset-section">
          <AssetToggle
            label="Product PDFs"
            icon="document"
            value={values.pdfMode}
            onChange={(v) => onChange('pdfMode', v)}
            disabled={disabled}
            options={pdfOptions}
          />
          {values.pdfMode === 'ai' && (
            <div className="p-3 bg-light rounded border mt-2">
              <RatioControl
                id="pdfRatio"
                label="Generation Ratio"
                value={values.pdfRatio}
                onChange={(v) => onChange('pdfRatio', v)}
                disabled={disabled}
              />
              <div className="form-group mb-0">
                <label
                  htmlFor="pdfContentType"
                  className="form-label font-weight-semi-bold"
                >
                  Content Type
                </label>
                <ClaySelect
                  id="pdfContentType"
                  aria-label="PDF Content Type"
                  value={values.pdfContentType || 'product_info'}
                  onChange={(e) => onChange('pdfContentType', e.target.value)}
                  disabled={disabled}
                >
                  <ClaySelect.Option
                    value="product_info"
                    label="Product Information"
                  />
                  <ClaySelect.Option value="user_guide" label="User Guide" />
                  <ClaySelect.Option
                    value="compliance"
                    label="Compliance & Regulations"
                  />
                  <ClaySelect.Option
                    value="technical_specs"
                    label="Technical Specifications"
                  />
                </ClaySelect>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
