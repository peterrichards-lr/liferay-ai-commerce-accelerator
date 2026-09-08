import React from 'react';
import ClayForm, { ClayInput, ClaySelect } from '@clayui/form';
import CheckboxGroup from '../ui/CheckboxGroup';
import {
  WAREHOUSE_STRATEGIES,
  WAREHOUSE_STRATEGY_OPTIONS,
  optionsForStrategy,
  strategyFromOptions,
  strategyOption,
} from '../../config/warehouseStrategy';

/**
 * Two checkboxes had four combinations and only three coherent ones, and the
 * fourth - create nothing, adopt nothing - is the state that leaves a run with
 * no warehouses and its inventory settings silently discarded. A dropdown
 * cannot express it.
 *
 * It also lets the count label follow the choice, which matters because
 * `warehouseCount` means different things per strategy: a target total when
 * topping up, a number to create otherwise, and nothing at all when no
 * warehouses are being created. See #730.
 */
function WarehousesToggle({
  productCount,
  values,
  onChange,
  disabled,
  existingWarehouseCount,
}) {
  const isMuted = productCount === 0;
  const strategy = strategyFromOptions(values);
  const { countLabel, description } = strategyOption(strategy);

  // Only a count we actually read rules the option out. An unknown count -
  // never fetched, or a request that failed - proves nothing, so the option
  // stays available and the run's own pre-flight refuses if it has to (#732).
  const knownEmpty = existingWarehouseCount === 0;

  // What the count will actually do, spelled out. The number means a target
  // total when topping up and a number to create otherwise, and saying which
  // is the point of the dropdown - a bare count of what exists would leave the
  // operator to do this arithmetic themselves.
  const outcome = (() => {
    if (typeof existingWarehouseCount !== 'number') {
      return null;
    }

    const requested = Number(values.warehouseCount) || 0;

    if (strategy === WAREHOUSE_STRATEGIES.EXISTING_ONLY) {
      return existingWarehouseCount === 0
        ? 'This instance has no warehouses, so there would be nowhere to put inventory.'
        : `Inventory will be placed in the ${existingWarehouseCount} warehouse(s) already here.`;
    }

    if (strategy === WAREHOUSE_STRATEGIES.FRESH_SET) {
      return existingWarehouseCount === 0
        ? `${requested} will be created.`
        : `${requested} will be created, leaving ${existingWarehouseCount + requested} in total. The existing ${existingWarehouseCount} will not receive inventory.`;
    }

    const toCreate = Math.max(0, requested - existingWarehouseCount);

    if (toCreate === 0) {
      return `${existingWarehouseCount} already here, so none will be created.`;
    }

    return `${existingWarehouseCount} already here, so ${toCreate} will be created to reach ${requested}.`;
  })();

  const handleStrategyChange = (value) => {
    const next = optionsForStrategy(value);

    onChange('createWarehouses', next.createWarehouses);
    onChange('reuseExistingWarehouses', next.reuseExistingWarehouses);
  };

  return (
    <CheckboxGroup title="Warehouses">
      <ClayForm.Group className="mb-2">
        <label
          htmlFor="dataGeneration_warehouseStrategy"
          className="form-label font-weight-semi-bold"
        >
          Warehouses
        </label>
        <ClaySelect
          id="dataGeneration_warehouseStrategy"
          value={strategy}
          onChange={(event) => handleStrategyChange(event.target.value)}
          disabled={disabled || isMuted}
        >
          {WAREHOUSE_STRATEGY_OPTIONS.map((option) => (
            <ClaySelect.Option
              key={option.value}
              label={option.label}
              value={option.value}
              disabled={
                knownEmpty &&
                option.value === WAREHOUSE_STRATEGIES.EXISTING_ONLY
              }
            />
          ))}
        </ClaySelect>
        <small className="help-text mt-1 d-block">{description}</small>
        {typeof existingWarehouseCount === 'number' && (
          <small className="text-secondary mt-1 d-block">{outcome}</small>
        )}
      </ClayForm.Group>

      {countLabel && (
        <ClayForm.Group className="mb-4">
          <label
            htmlFor="dataGeneration_warehouseCount"
            className="form-label font-weight-semi-bold"
          >
            {countLabel}
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
