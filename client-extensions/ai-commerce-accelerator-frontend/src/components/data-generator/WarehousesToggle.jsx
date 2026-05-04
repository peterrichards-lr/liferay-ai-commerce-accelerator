import React from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
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
        <ClayForm.Group className="mb-4">
          <label
            htmlFor="dataGeneration_warehouseCount"
            className="form-label font-weight-semi-bold"
          >
            Number of Warehouses
          </label>
          <ClayInput
            id="dataGeneration_warehouseCount"
            type="number"
            min="1"
            max="10"
            value={values.warehouseCount}
            onChange={(e) =>
              onChange('warehouseCount', parseInt(e.target.value) || 1)
            }
            disabled={disabled || isMuted}
          />
        </ClayForm.Group>
      )}

      <div className="d-flex flex-column mb-3">
        <CheckboxField
          id="dataGeneration_reuseExistingWarehouses"
          checked={values.reuseExistingWarehouses}
          onChange={(v) => onChange('reuseExistingWarehouses', v)}
          disabled={disabled || !values.createWarehouses}
          label="Reuse existing warehouses if found"
          muted={isMuted}
        />
        <small className="help-text mt-1 mb-2 pl-4">
          When enabled, new warehouses are created only if none exist. Otherwise
          existing ones are reused.
        </small>
      </div>
    </CheckboxGroup>
  );
}

export default WarehousesToggle;
