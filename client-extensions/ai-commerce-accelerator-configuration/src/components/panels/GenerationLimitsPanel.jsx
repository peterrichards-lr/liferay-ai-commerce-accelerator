import React, { useCallback, useMemo } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';

const LIMITS_CONFIG_KEY = 'generation-limits';
const DEFAULTS = {
  [LIMITS_CONFIG_KEY]: {
    maxProducts: 100,
    maxAccounts: 50,
    maxOrders: 200,
    defaultOrderDistribution: {
      open: 5,
      processing: 5,
      shipped: 10,
      completed: 30,
    },
  },
};

const STATUS_CONFIG = [
  { key: 'open', label: 'Open (Baskets)', color: 'bg-secondary' },
  { key: 'processing', label: 'Processing', color: 'bg-primary' },
  { key: 'shipped', label: 'Shipped', color: 'bg-info' },
  { key: 'completed', label: 'Fulfilled', color: 'bg-success' },
];

export default function GenerationLimitsPanel() {
  const { config, loading, persist, reload } = useObjectStorage(
    [LIMITS_CONFIG_KEY],
    DEFAULTS
  );

  const {
    data,
    errors,
    isDirty,
    isSubmitting,
    reset,
    setData,
    setErrors,
    submit,
  } = useForm({
    initialData: config,
    onSubmit: async (formData) => {
      await persist(formData);
    },
  });

  const handleLimitChange = (key, val) => {
    setData((prev) => ({
      ...prev,
      [LIMITS_CONFIG_KEY]: {
        ...prev[LIMITS_CONFIG_KEY],
        [key]: parseInt(val, 10) || 0,
      },
    }));
  };

  const handleDistChange = (key, val) => {
    setData((prev) => ({
      ...prev,
      [LIMITS_CONFIG_KEY]: {
        ...prev[LIMITS_CONFIG_KEY],
        defaultOrderDistribution: {
          ...prev[LIMITS_CONFIG_KEY].defaultOrderDistribution,
          [key]: parseInt(val, 10) || 0,
        },
      },
    }));
  };

  if (loading) return <div className="loading-animation" />;

  const limits = data[LIMITS_CONFIG_KEY];

  return (
    <div className="generation-limits-panel">
      <div className="sheet-header">
        <h2 className="sheet-title">Generation Limits & Default Ratios</h2>
        <div className="sheet-text">
          Configure the maximum values allowed on the dashboard and the default
          order status distribution.
        </div>
      </div>

      <div className="sheet-body">
        {errors.global && (
          <ClayAlert
            displayType="danger"
            onClose={() => setErrors({})}
            title="Error"
          >
            {errors.global}
          </ClayAlert>
        )}

        <ClayLayout.Row>
          <ClayLayout.Col size={4}>
            <ClayForm.Group>
              <label htmlFor="maxProducts">Max Products</label>
              <ClayInput
                id="maxProducts"
                type="number"
                value={limits.maxProducts}
                onChange={(e) => handleLimitChange('maxProducts', e.target.value)}
              />
            </ClayForm.Group>
          </ClayLayout.Col>
          <ClayLayout.Col size={4}>
            <ClayForm.Group>
              <label htmlFor="maxAccounts">Max Accounts</label>
              <ClayInput
                id="maxAccounts"
                type="number"
                value={limits.maxAccounts}
                onChange={(e) => handleLimitChange('maxAccounts', e.target.value)}
              />
            </ClayForm.Group>
          </ClayLayout.Col>
          <ClayLayout.Col size={4}>
            <ClayForm.Group>
              <label htmlFor="maxOrders">Max Orders</label>
              <ClayInput
                id="maxOrders"
                type="number"
                value={limits.maxOrders}
                onChange={(e) => handleLimitChange('maxOrders', e.target.value)}
              />
            </ClayForm.Group>
          </ClayLayout.Col>
        </ClayLayout.Row>

        <h3 className="sheet-subtitle mt-4">Default Order Distribution</h3>
        <ClayLayout.Row>
          {STATUS_CONFIG.map(({ key, label, color }) => (
            <ClayLayout.Col key={key} size={3}>
              <ClayForm.Group>
                <div className="d-flex align-items-center mb-1">
                  <span
                    className={`d-inline-block rounded-circle ${color} mr-2`}
                    style={{ width: '10px', height: '10px' }}
                  ></span>
                  <label htmlFor={`dist-${key}`} className="mb-0">
                    {label}
                  </label>
                </div>
                <ClayInput
                  id={`dist-${key}`}
                  type="number"
                  value={limits.defaultOrderDistribution[key]}
                  onChange={(e) => handleDistChange(key, e.target.value)}
                />
              </ClayForm.Group>
            </ClayLayout.Col>
          ))}
        </ClayLayout.Row>
      </div>

      <div className="sheet-footer">
        <ClayButton
          disabled={!isDirty || isSubmitting}
          displayType="primary"
          onClick={submit}
        >
          {isSubmitting ? 'Saving...' : 'Save Settings'}
        </ClayButton>
        <ClayButton
          className="ml-2"
          disabled={!isDirty || isSubmitting}
          displayType="secondary"
          onClick={reset}
        >
          Cancel
        </ClayButton>
      </div>
    </div>
  );
}
