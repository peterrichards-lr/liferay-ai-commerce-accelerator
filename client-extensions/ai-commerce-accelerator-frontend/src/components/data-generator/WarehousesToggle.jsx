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

      {values.createWarehouses && (
        <div className="form-group">
          <label htmlFor="dataGeneration_warehouseCount">Number of Warehouses</label>
          <input
            id="dataGeneration_warehouseCount"
            type="number"
            className="form-input"
            min="1"
            max="10"
            value={values.warehouseCount}
            onChange={(e) => onChange('warehouseCount', parseInt(e.target.value))}
            disabled={disabled || isMuted}
          />
        </div>
      )}

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
