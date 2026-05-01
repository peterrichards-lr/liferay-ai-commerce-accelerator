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
      <h6 className={`config-section-title ${isMuted ? 'muted' : ''}`}>
        Product Enrichment & Data
      </h6>
      <div className="toggle-list">
        <CheckboxField
          id="dataGeneration_generatePriceLists"
          checked={values.generatePriceLists}
          onChange={(v) => onChange('generatePriceLists', v)}
          disabled={disabled || isMuted}
          label="Generate Price Lists"
          muted={isMuted}
        />
        <div className="pl-4">
          <CheckboxField
            id="dataGeneration_generateBulkPricing"
            checked={values.generateBulkPricing}
            onChange={(v) => onChange('generateBulkPricing', v)}
            disabled={disabled || isMuted || !values.generatePriceLists}
            label="Incl. Bulk Pricing"
            muted={isMuted || !values.generatePriceLists}
          />
          <CheckboxField
            id="dataGeneration_generateTierPricing"
            checked={values.generateTierPricing}
            onChange={(v) => onChange('generateTierPricing', v)}
            disabled={disabled || isMuted || !values.generatePriceLists}
            label="Incl. Tiered Pricing"
            muted={isMuted || !values.generatePriceLists}
          />
        </div>
        <CheckboxField
          id="dataGeneration_generateSpecifications"
          checked={values.generateSpecifications}
          onChange={(v) => onChange('generateSpecifications', v)}
          disabled={disabled || isMuted}
          label="Generate Specifications"
          muted={isMuted}
        />
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
  );
}
