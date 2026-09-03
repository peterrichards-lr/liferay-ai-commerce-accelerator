import React, { useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayButton from '@clayui/button';
import ClayLayout from '@clayui/layout';
import ClayAlert from '@clayui/alert';
import { useForm, useObjectStorage } from '../../hooks';

const CHUNK_SIZES_CONFIG_KEY = 'ai-chunk-sizes';
const DEFAULTS = {
  [CHUNK_SIZES_CONFIG_KEY]: {
    product: 10,
    account: 10,
    order: 10,
    warehouse: 10,
  },
};

const ENTITY_CONFIG = [
  {
    key: 'product',
    label: 'Product Chunk Size',
    helper:
      'Number of products generated per AI call. Smaller chunks (5–10) prevent output token truncation and allow generating hundreds of products reliably.',
  },
  {
    key: 'account',
    label: 'Account Chunk Size',
    helper:
      'Number of accounts generated per AI call. Chunks of 10–20 prevent schema truncation when generating large batches of B2B and consumer accounts.',
  },
  {
    key: 'order',
    label: 'Order Chunk Size',
    helper:
      'Number of orders generated per AI call. Chunks of 10–20 ensure complex order line items and purchase histories are generated reliably without hitting output token limits.',
  },
  {
    key: 'warehouse',
    label: 'Warehouse Chunk Size',
    helper:
      'Number of warehouses generated per AI call. Chunks of 10–20 ensure geographic address and coordinate data generate reliably without truncation.',
  },
];

export default function AiChunkSizesPanel() {
  const {
    loading,
    saving,
    values: { [CHUNK_SIZES_CONFIG_KEY]: chunkSizes },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [CHUNK_SIZES_CONFIG_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });
  const [error, setError] = useState(null);

  const handleChange = (key, val) => {
    const num = parseInt(val, 10) || 1;
    if (num < 1 || num > 50) {
      setError(`${key} chunk size must be between 1 and 50.`);
    } else {
      setError(null);
    }
    setValue(CHUNK_SIZES_CONFIG_KEY, {
      ...chunkSizes,
      [key]: num,
    });
  };

  const handleReset = () => {
    setValue(CHUNK_SIZES_CONFIG_KEY, DEFAULTS[CHUNK_SIZES_CONFIG_KEY]);
    setError(null);
  };

  if (loading) {
    return (
      <div className="text-center p-4">
        <span
          className="inline-item inline-item-before spinner-border spinner-border-sm"
          role="status"
        />
        Loading chunk size configuration...
      </div>
    );
  }

  return (
    <div className="panel-body">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="sheet-title mb-1">AI Chunk Sizes</h2>
          <div className="text-secondary small">
            Configure how many items are requested per LLM generation call for
            each entity type. Splitting generation into smaller chunks prevents
            token window exhaustion and allows generating hundreds of entities
            reliably.
          </div>
        </div>
        <div className="d-flex gap-2">
          <ClayButton
            displayType="secondary"
            onClick={handleReset}
            disabled={saving}
          >
            Defaults
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
          >
            Cancel
          </ClayButton>
          <ClayButton
            displayType="primary"
            onClick={onSave}
            disabled={!dirty || saving || !!error}
          >
            {saving ? 'Saving...' : 'Save'}
          </ClayButton>
        </div>
      </div>

      {error && (
        <ClayAlert
          displayType="danger"
          title="Validation Error"
          className="mb-4"
        >
          {error}
        </ClayAlert>
      )}

      <ClayLayout.Row>
        {ENTITY_CONFIG.map(({ key, label, helper }) => (
          <ClayLayout.Col size={6} key={key}>
            <div className="card card-horizontal mb-4 p-3 border">
              <ClayForm.Group>
                <label
                  htmlFor={`chunk-size-${key}`}
                  className="font-weight-bold"
                >
                  {label}
                </label>
                <ClayInput
                  id={`chunk-size-${key}`}
                  type="number"
                  min={1}
                  max={50}
                  value={chunkSizes?.[key] ?? 10}
                  onChange={(e) => handleChange(key, e.target.value)}
                />
                <small className="form-text text-secondary mt-2">
                  {helper}
                </small>
              </ClayForm.Group>
            </div>
          </ClayLayout.Col>
        ))}
      </ClayLayout.Row>
    </div>
  );
}
