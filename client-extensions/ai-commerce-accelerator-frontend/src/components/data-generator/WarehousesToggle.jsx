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
      <small className="help-text mt-1 mb-3 pl-4 d-block">
        When disabled, the warehouses already in the instance are used for
        inventory and linked to this run&apos;s channels instead.
      </small>

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
    </CheckboxGroup>
  );
}

export default WarehousesToggle;
