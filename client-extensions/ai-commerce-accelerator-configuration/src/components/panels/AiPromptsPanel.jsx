import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import PromptEditor from './PromptEditor';
import { getKeyValue, persistConfigKey } from '../../utils/api';
import { useForm } from '../../hooks';

const ENTITY_CONFIGS = [
  { id: 'product', title: 'Product Prompt', configKey: 'ai-prompt-product' },
  { id: 'account', title: 'Account Prompt', configKey: 'ai-prompt-account' },
  { id: 'order', title: 'Order Prompt', configKey: 'ai-prompt-order' },
  { id: 'pricing', title: 'Pricing Prompt', configKey: 'ai-prompt-pricing' },
];

const EMPTY_PROMPTS = ENTITY_CONFIGS.reduce((accumulator, { id }) => {
  accumulator[id] = '';
  return accumulator;
}, {});

export default function AiPromptsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prompts, setPrompts] = useState(EMPTY_PROMPTS);
  const [lastSavedPrompts, setLastSavedPrompts] = useState(EMPTY_PROMPTS);

  const dirty = useMemo(
    () => JSON.stringify(prompts) !== JSON.stringify(lastSavedPrompts),
    [prompts, lastSavedPrompts]
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const values = await Promise.all(
          ENTITY_CONFIGS.map(({ configKey }) => getKeyValue(configKey))
        );

        const newPrompts = {};
        ENTITY_CONFIGS.forEach(({ id }, index) => {
          newPrompts[id] = values[index] || '';
        });

        if (!alive) {
          return;
        }

        setPrompts(newPrompts);
        setLastSavedPrompts(newPrompts);
      } catch (error) {
        console.error('Failed to load AI prompts.', error);
        Liferay?.Util?.openToast?.({
          message: 'Failed to load AI prompts.',
          type: 'danger',
        });
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const onPromptChange = (promptId, value) => {
    setPrompts((previous) => ({
      ...previous,
      [promptId]: value,
    }));
  };

  const onSave = useCallback(async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        ENTITY_CONFIGS.map(({ id, configKey }) =>
          persistConfigKey(configKey, prompts[id])
        )
      );

      setLastSavedPrompts(prompts);

      Liferay?.Util?.openToast?.({
        message: 'AI prompts saved.',
        type: 'success',
      });
    } catch (error) {
      console.error(error);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save AI prompts.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, prompts]);

  useForm({ dirty, onSave });

  const onCancel = useCallback(() => {
    setPrompts(lastSavedPrompts);
  }, [lastSavedPrompts]);

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
              value={prompts[id]}
              onChange={(value) => onPromptChange(id, value)}
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
