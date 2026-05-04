import React from 'react';
import ClayIcon from '@clayui/icon';
import ClayForm, { ClayInput } from '@clayui/form';
import FieldError from '../ui/FieldError';
import CheckboxField from '../ui/CheckboxField';

function InventoryControls({
  productCount,
  inventoryMin,
  inventoryMax,
  inventoryAssignmentRatio,
  enableBackorders,
  backorderAssignmentRatio,
  onChange,
  disabled,
  validationErrors,
}) {
  const hasErr = (key) => (validationErrors?.[key] || []).length > 0;

  return (
    <div className="form-group mt-2">
      <h6
        className={`config-section-title mb-4 ${productCount === 0 ? 'muted' : ''}`}
      >
        <ClayIcon symbol="box-container" />
        Inventory & Backorders
      </h6>

      <div className="form-row gx-4 gy-4">
        <div className="form-col">
          <ClayForm.Group className="mb-0">
            <label
              htmlFor="dg_inventoryMin"
              className="form-label font-weight-semi-bold"
            >
              Inventory Min
            </label>
            <ClayInput
              id="dg_inventoryMin"
              type="number"
              className={hasErr('inventoryMin') ? 'is-invalid' : ''}
              min="0"
              value={inventoryMin ?? 0}
              onChange={(e) =>
                onChange('inventoryMin', parseInt(e.target.value || '0'))
              }
              disabled={disabled || productCount === 0}
            />
            {hasErr('inventoryMin') && (
              <FieldError errors={validationErrors.inventoryMin} />
            )}
          </ClayForm.Group>
        </div>

        <div className="form-col">
          <ClayForm.Group className="mb-0">
            <label
              htmlFor="dg_inventoryMax"
              className="form-label font-weight-semi-bold"
            >
              Inventory Max
            </label>
            <ClayInput
              id="dg_inventoryMax"
              type="number"
              className={hasErr('inventoryMax') ? 'is-invalid' : ''}
              min="0"
              value={inventoryMax ?? 0}
              onChange={(e) =>
                onChange('inventoryMax', parseInt(e.target.value || '0'))
              }
              disabled={disabled || productCount === 0}
            />
            {hasErr('inventoryMax') && (
              <FieldError errors={validationErrors.inventoryMax} />
            )}
          </ClayForm.Group>
        </div>

        <div className="form-col">
          <div className="form-group mb-0">
            <label
              htmlFor="dg_inventoryAssignmentRatio"
              className="form-label font-weight-semi-bold"
            >
              Apply Inventory To ({inventoryAssignmentRatio ?? 0}%)
            </label>
            <input
              id="dg_inventoryAssignmentRatio"
              type="range"
              className="form-control-range"
              min="0"
              max="100"
              step="10"
              value={inventoryAssignmentRatio ?? 0}
              onChange={(e) =>
                onChange('inventoryAssignmentRatio', parseInt(e.target.value))
              }
              disabled={disabled || productCount === 0}
            />
            {hasErr('inventoryAssignmentRatio') && (
              <FieldError errors={validationErrors.inventoryAssignmentRatio} />
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <CheckboxField
          id="dg_enableBackorders"
          label="Enable Backorders"
          checked={!!enableBackorders}
          onChange={(val) => onChange('enableBackorders', val)}
          disabled={disabled || productCount === 0}
        />
      </div>

      {enableBackorders && (
        <div className="form-row mt-3">
          <div className="form-col">
            <div className="form-group mb-0">
              <label
                htmlFor="dg_backorderAssignmentRatio"
                className="form-label font-weight-semi-bold"
              >
                Apply Backorders To ({backorderAssignmentRatio ?? 0}%)
              </label>
              <input
                id="dg_backorderAssignmentRatio"
                type="range"
                className="form-control-range"
                min="0"
                max="100"
                step="10"
                value={backorderAssignmentRatio ?? 0}
                onChange={(e) =>
                  onChange('backorderAssignmentRatio', parseInt(e.target.value))
                }
                disabled={disabled || productCount === 0}
              />
              {hasErr('backorderAssignmentRatio') && (
                <FieldError
                  errors={validationErrors.backorderAssignmentRatio}
                />
              )}
              <small className="help-text">
                Randomly enables backorders on this percentage of products.
              </small>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3">
        <small className="help-text text-muted">
          Inventory values will be split across warehouses. If none exist, they
          will be created first.
        </small>
      </div>
    </div>
  );
}

export default InventoryControls;
