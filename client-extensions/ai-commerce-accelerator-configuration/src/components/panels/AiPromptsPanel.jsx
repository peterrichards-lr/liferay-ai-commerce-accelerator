import React from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import PromptEditor from './PromptEditor';
import { useForm, useObjectStorage } from '../../hooks';

const ENTITY_CONFIGS = [
  { id: 'product', title: 'Product Prompt', configKey: 'ai-prompt-product' },
  { id: 'account', title: 'Account Prompt', configKey: 'ai-prompt-account' },
  { id: 'order', title: 'Order Prompt', configKey: 'ai-prompt-order' },
  { id: 'pricing', title: 'Pricing Prompt', configKey: 'ai-prompt-pricing' },
  { id: 'pdf', title: 'PDF Prompt', configKey: 'ai-prompt-pdf' },
  {
    id: 'warehouse',
    title: 'Warehouse Prompt',
    configKey: 'ai-prompt-warehouse',
  },
];

const { keys, defaults } = ENTITY_CONFIGS.reduce(
  (acc, { configKey, id: _id }) => {
    acc.keys.push(configKey);
    acc.defaults[configKey] = '';
    return acc;
  },
  {
    keys: [],
    defaults: {},
  }
);

export default function AiPromptsPanel() {
  const {
    loading,
    saving,
    values: prompts,
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys,
    defaults,
    json: false,
  });

  useForm({ dirty, onSave });

  return (
    <>
      <div className="sheet-header">
        <h2 className="sheet-title">AI Prompts</h2>
        <div className="sheet-text">
          Define the system prompts for the AI-generated data.
        </div>
      </div>
      <div className="sheet-section">
        {loading ? (
          <div aria-busy="true">Loading...</div>
        ) : (
          ENTITY_CONFIGS.map(({ id, title, configKey }) => (
            <PromptEditor
              key={id}
              configKey={configKey}
              title={title}
              value={prompts[configKey]}
              onChange={(value) => setValue(configKey, value)}
            />
          ))
        )}
      </div>
      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={!dirty || saving}
            aria-label="Save AI prompts"
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
            aria-label="Cancel changes"
          >
            <ClayIcon symbol="restore" />
            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </>
  );
}
