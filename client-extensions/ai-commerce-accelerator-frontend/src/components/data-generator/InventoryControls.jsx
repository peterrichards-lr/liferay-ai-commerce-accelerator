import React from 'react';
import ClayIcon from '@clayui/icon';
import FieldError from '../ui/FieldError';

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
    <div className="form-group">
      <h6
        className={`config-section-title ${productCount === 0 ? 'muted' : ''}`}
      >
        <ClayIcon symbol="box-container" />
        Inventory & Backorders
      </h6>

      <div className="form-row">
        <div className="form-col">
          <label htmlFor="dg_inventoryMin">Inventory Min</label>
          <input
            id="dg_inventoryMin"
            type="number"
            className={`form-input ${hasErr('inventoryMin') ? 'invalid' : ''}`}
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
        </div>

        <div className="form-col">
          <label htmlFor="dg_inventoryMax">Inventory Max</label>
          <input
            id="dg_inventoryMax"
            type="number"
            className={`form-input ${hasErr('inventoryMax') ? 'invalid' : ''}`}
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
        </div>

        <div className="form-col">
          <label htmlFor="dg_inventoryAssignmentRatio">
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

      <div className="checkbox-wrapper mt-3">
        <input
          className="checkbox-input"
          type="checkbox"
          id="dg_enableBackorders"
          checked={!!enableBackorders}
          onChange={(e) => onChange('enableBackorders', e.target.checked)}
          disabled={disabled || productCount === 0}
        />
        <label
          className="checkbox-label font-weight-bold"
          htmlFor="dg_enableBackorders"
        >
          Enable Backorders
        </label>
      </div>

      {enableBackorders && (
        <div className="form-row mt-2">
          <div className="form-col">
            <label htmlFor="dg_backorderAssignmentRatio">
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
              <FieldError errors={validationErrors.backorderAssignmentRatio} />
            )}
            <small className="help-text">
              Randomly enables backorders on this percentage of products.
            </small>
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
