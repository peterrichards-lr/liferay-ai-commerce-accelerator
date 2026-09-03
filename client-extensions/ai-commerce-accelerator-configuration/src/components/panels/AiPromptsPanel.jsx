import React, { useRef, useCallback } from 'react';
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
  { id: 'promo', title: 'Promotion Prompt', configKey: 'ai-prompt-promo' },
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

  const fileInputRef = useRef(null);

  const handleExportAll = useCallback(() => {
    const exportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      prompts,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aica-prompts.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [prompts]);

  const handleImportAll = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result || '{}');
          const importedPrompts = parsed.prompts || parsed;
          Object.entries(importedPrompts).forEach(([k, v]) => {
            if (keys.includes(k) && typeof v === 'string') {
              setValue(k, v);
            }
          });
        } catch (err) {
          console.error('Failed to parse imported prompts JSON:', err);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsText(file);
    },
    [setValue]
  );

  return (
    <>
      <div className="sheet-header d-flex justify-content-between align-items-center">
        <div>
          <h2 className="sheet-title">AI Prompts</h2>
          <div className="sheet-text">
            Define the system prompts for the AI-generated data.
          </div>
        </div>
        <div className="btn-group">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json"
            onChange={handleImportAll}
          />
          <ClayButton
            displayType="secondary"
            onClick={() => fileInputRef.current?.click()}
            title="Import all prompts from JSON"
            className="mr-2"
            aria-label="Import all prompts"
          >
            <ClayIcon symbol="upload" />
            <span className="ml-2">Import All</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={handleExportAll}
            title="Export all prompts to JSON"
            aria-label="Export all prompts"
          >
            <ClayIcon symbol="download" />
            <span className="ml-2">Export All</span>
          </ClayButton>
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
