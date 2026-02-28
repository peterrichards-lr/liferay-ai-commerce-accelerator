import React from 'react';
import CheckboxGroup from '../ui/CheckboxGroup';
import CheckboxField from '../ui/CheckboxField';

export default function ProductToggleSet({
  productCount,
  values,
  onChange,
  disabled,
}) {
  const isMuted = productCount === 0;

  return (
    <CheckboxGroup title="Pricing & Data Options">
      <CheckboxField
        id="dataGeneration_generatePriceLists"
        checked={values.generatePriceLists}
        onChange={(v) => onChange('generatePriceLists', v)}
        disabled={disabled || isMuted}
        label="Generate Price Lists"
        muted={isMuted}
      />
      <CheckboxField
        id="dataGeneration_generateBulkPricing"
        checked={values.generateBulkPricing}
        onChange={(v) => onChange('generateBulkPricing', v)}
        disabled={disabled || isMuted}
        label="Generate Bulk Pricing"
        muted={isMuted}
      />
      <CheckboxField
        id="dataGeneration_generateTierPricing"
        checked={values.generateTierPricing}
        onChange={(v) => onChange('generateTierPricing', v)}
        disabled={disabled || isMuted}
        label="Generate Tier Pricing"
        muted={isMuted}
      />
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
        label="Generate SKU Variants (Size, Color, etc.)"
        muted={isMuted}
      />
    </CheckboxGroup>
  );
}
