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
      <h6 className={`config-section-title ${productCount === 0 ? 'muted' : ''}`}>
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
            onChange={(e) => onChange('inventoryMin', parseInt(e.target.value || '0'))}
            disabled={disabled || productCount === 0}
          />
          {hasErr('inventoryMin') && <FieldError errors={validationErrors.inventoryMin} />}
        </div>

        <div className="form-col">
          <label htmlFor="dg_inventoryMax">Inventory Max</label>
          <input
            id="dg_inventoryMax"
            type="number"
            className={`form-input ${hasErr('inventoryMax') ? 'invalid' : ''}`}
            min="0"
            value={inventoryMax ?? 0}
            onChange={(e) => onChange('inventoryMax', parseInt(e.target.value || '0'))}
            disabled={disabled || productCount === 0}
          />
          {hasErr('inventoryMax') && <FieldError errors={validationErrors.inventoryMax} />}
        </div>

        <div className="form-col">
          <label htmlFor="dg_inventoryAssignmentRatio">Apply Inventory To</label>
          <div className="input-with-unit">
            <input
              id="dg_inventoryAssignmentRatio"
              type="number"
              className={`form-input ${hasErr('inventoryAssignmentRatio') ? 'invalid' : ''}`}
              min="0"
              max="100"
              value={inventoryAssignmentRatio ?? 0}
              onChange={(e) => onChange('inventoryAssignmentRatio', parseInt(e.target.value || '0'))}
              disabled={disabled || productCount === 0}
            />
            <span className="input-unit">%</span>
          </div>
          {hasErr('inventoryAssignmentRatio') && (
            <FieldError errors={validationErrors.inventoryAssignmentRatio} />
          )}
          <small className="help-text">Randomly assigns inventory to this percentage of products.</small>
        </div>
      </div>

      <div className="checkbox-wrapper mt-2">
        <input
          className="checkbox-input"
          type="checkbox"
          id="dg_enableBackorders"
          checked={!!enableBackorders}
          onChange={(e) => onChange('enableBackorders', e.target.checked)}
          disabled={disabled || productCount === 0}
        />
        <label className="checkbox-label" htmlFor="dg_enableBackorders">
          Enable Backorders
        </label>
      </div>

      <div className="form-row">
        <div className="form-col">
          <label htmlFor="dg_backorderAssignmentRatio">Apply Backorders To</label>
          <div className="input-with-unit">
            <input
              id="dg_backorderAssignmentRatio"
              type="number"
              className={`form-input ${hasErr('backorderAssignmentRatio') ? 'invalid' : ''}`}
              min="0"
              max="100"
              value={backorderAssignmentRatio ?? 0}
              onChange={(e) => onChange('backorderAssignmentRatio', parseInt(e.target.value || '0'))}
              disabled={disabled || productCount === 0 || !enableBackorders}
            />
            <span className="input-unit">%</span>
          </div>
          {hasErr('backorderAssignmentRatio') && (
            <FieldError errors={validationErrors.backorderAssignmentRatio} />
          )}
          <small className="help-text">Randomly enables backorders on this percentage of products.</small>
        </div>
      </div>

      <small className="help-text">
        Inventory values will be split across available warehouses. If none exist and "Create Warehouses" is enabled,
        warehouses will be created first.
      </small>
    </div>
  );
}

export default InventoryControls;