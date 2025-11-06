import React from 'react';
import CheckboxGroup from '../ui/CheckboxGroup';
import CheckboxField from '../ui/CheckboxField';

function WarehousesToggle({ productCount, values, onChange, disabled }) {
  const isMuted = productCount === 0;
  return (
    <CheckboxGroup title="Warehouses">
      <CheckboxField
        id="dataGeneration_createWarehouses"
        checked={values.createWarehouses}
        onChange={(v) => onChange('createWarehouses', v)}
        disabled={disabled || isMuted}
        label="Create Warehouses"
        muted={isMuted}
      />

      <CheckboxField
        id="dataGeneration_reuseExistingWarehouses"
        checked={values.reuseExistingWarehouses}
        onChange={(v) => onChange('reuseExistingWarehouses', v)}
        disabled={disabled || !values.createWarehouses}
        label="Reuse existing warehouses if found"
        muted={isMuted}
      />
      <small className="help-text">
        When enabled, new warehouses are created only if none exist. Otherwise
        existing ones are reused.
      </small>
    </CheckboxGroup>
  );
}

export default WarehousesToggle;
