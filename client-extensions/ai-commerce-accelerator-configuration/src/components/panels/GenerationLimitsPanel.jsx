import React from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';

const LIMITS_CONFIG_KEY = 'generation-limits';
const DEFAULTS = {
  [LIMITS_CONFIG_KEY]: {
    maxProducts: 10000,
    maxAccounts: 5000,
    maxOrders: 50000,
    defaultOrderDistribution: {
      open: 10,
      processing: 10,
      shipped: 20,
      completed: 60,
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
  const {
    loading,
    saving,
    values: { [LIMITS_CONFIG_KEY]: limits },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [LIMITS_CONFIG_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

  const handleLimitChange = (key, val) => {
    setValue(LIMITS_CONFIG_KEY, {
      ...limits,
      [key]: parseInt(val, 10) || 0,
    });
  };

  const handleDistChange = (key, val) => {
    setValue(LIMITS_CONFIG_KEY, {
      ...limits,
      defaultOrderDistribution: {
        ...limits.defaultOrderDistribution,
        [key]: parseInt(val, 10) || 0,
      },
    });
  };

  if (loading) return <div className="loading-animation" />;

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Generation Limits & Default Ratios</h2>
        <div className="sheet-text">
          Configure the maximum values allowed on the dashboard and the default
          order status distribution.
        </div>
      </div>

      <div className="sheet-section">
        <ClayLayout.Row>
          <ClayLayout.Col size={4}>
            <ClayForm.Group>
              <label htmlFor="maxProducts">Max Products</label>
              <ClayInput
                id="maxProducts"
                type="number"
                value={limits.maxProducts}
                onChange={(e) =>
                  handleLimitChange('maxProducts', e.target.value)
                }
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
                onChange={(e) =>
                  handleLimitChange('maxAccounts', e.target.value)
                }
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
        <div className="btn-group-item">
          <ClayButton
            displayType="primary"
            onClick={onSave}
            disabled={!dirty || saving}
            className="mr-2"
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
          >
            <ClayIcon symbol="restore" />
            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </ClayLayout.Sheet>
  );
}
