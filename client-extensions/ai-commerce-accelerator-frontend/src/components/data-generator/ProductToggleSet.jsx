import React from 'react';
import CheckboxField from '../ui/CheckboxField';

export default function ProductToggleSet({
  productCount,
  values,
  onChange,
  disabled,
}) {
  const isMuted = productCount === 0;

  return (
    <div className="product-toggle-set">
      <h6 className={`config-section-title mb-4 ${isMuted ? 'muted' : ''}`}>
        Product Enrichment & Data
      </h6>
      <div className="toggle-list">
        <div className="mb-3">
          <CheckboxField
            id="dataGeneration_generatePriceLists"
            checked={values.generatePriceLists}
            onChange={(v) => onChange('generatePriceLists', v)}
            disabled={disabled || isMuted}
            label="Generate Price Lists"
            muted={isMuted}
          />
        </div>
        {values.generatePriceLists && (
          <div
            className="toggle-list-nested ml-5 mt-3 mb-3 d-flex flex-column"
            style={{ gap: '0.75rem' }}
          >
            <CheckboxField
              id="dataGeneration_generateBulkPricing"
              checked={values.generateBulkPricing}
              onChange={(v) => onChange('generateBulkPricing', v)}
              disabled={disabled || isMuted}
              label="Incl. Bulk Pricing"
              muted={isMuted}
            />
            <CheckboxField
              id="dataGeneration_generateTierPricing"
              checked={values.generateTierPricing}
              onChange={(v) => onChange('generateTierPricing', v)}
              disabled={disabled || isMuted}
              label="Incl. Tiered Pricing"
              muted={isMuted}
            />
          </div>
        )}
        <div className="mb-3">
          <CheckboxField
            id="dataGeneration_generateSpecifications"
            checked={values.generateSpecifications}
            onChange={(v) => onChange('generateSpecifications', v)}
            disabled={disabled || isMuted}
            label="Generate Specifications"
            muted={isMuted}
          />
        </div>
        <div className="mb-3">
          <CheckboxField
            id="dataGeneration_generateSkuVariants"
            checked={values.generateSkuVariants}
            onChange={(v) => onChange('generateSkuVariants', v)}
            disabled={disabled || isMuted}
            label="Generate SKU Variants"
            muted={isMuted}
          />
        </div>
      </div>
    </div>
  );
}
